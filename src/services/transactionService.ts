import { assertLockContractAsset } from './currencyService';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Memo,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { StatusCodes } from 'http-status-codes';
import CircuitBreaker from 'opossum';
import { stellarConfig } from '../config/stellar';
import { deliveryService } from './delivery.service';
import { DeliveryStatus, IDelivery } from '../models/Delivery';
import { fromStroops, toStroops } from '../utils/stroops';
import AppError from '../utils/AppError';
import logger from '../config/logger';
import env from '../config/env';
import { createCircuitBreaker, fireWithBreaker } from '../utils/circuitBreaker';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';
import { estimateTransactionFee } from './sorobanFees';

/** Input accepted by {@link TransactionService.buildEscrowLockXdr}. */
export interface EscrowLockXdrInput {
  deliveryId: string;
  payerAddress: string;
}

/** Unsigned transaction envelope returned to the client wallet. */
export interface EscrowLockXdrResult {
  xdr: string;
  network: string;
  networkPassphrase: string;
  contractId: string;
  contractFunction: string;
  sourceAccount: string;
  sequence: string;
  fee: string;
  validUntil: number;
  delivery: {
    id: string;
    deliveryId?: string;
    trackingNumber?: string;
    status: DeliveryStatus;
  };
  amount: {
    assetCode: string;
    value: number;
    stroops: string;
    formatted: string;
  };
}

/** Normalise varied SDK error shapes into a plain message string. */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** Delivery states for which locking new escrow funds makes no sense. */
const NON_LOCKABLE_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
  DeliveryStatus.COMPLETED,
  DeliveryStatus.CANCELLED,
]);

/**
 * TransactionService builds unsigned Soroban transactions on behalf of the
 * frontend, now protected by a circuit breaker on every RPC call.
 *
 * Circuit-breaker strategy:
 *   The two RPC calls made here — `getAccount` and `prepareTransaction` — each
 *   go through the shared `soroban-rpc-tx` circuit breaker.  When the breaker
 *   is OPEN both calls immediately throw a typed `AppError(503)` so the
 *   controller can surface a clean "service temporarily unavailable" response
 *   without waiting for a TCP timeout.
 */
export class TransactionService {
  private readonly client: ISorobanRpcClient;
  private readonly breaker: CircuitBreaker<[() => Promise<unknown>], unknown>;

  constructor(client: ISorobanRpcClient = defaultSorobanRpcClient) {
    this.client = client;

    // A dedicated breaker for transaction-building RPC calls.  We use a
    // separate instance (not the shared soroban-rpc one from SorobanService)
    // so that heavy escrow-lock simulation failures don't affect the
    // lighter connectivity/health checks, and vice-versa.
    this.breaker = createCircuitBreaker<[() => Promise<unknown>], unknown>({
      name: 'soroban-rpc-tx',
      errorThresholdPercentage: env.CB_SOROBAN_ERROR_THRESHOLD_PERCENTAGE,
      rollingWindowMs: env.CB_SOROBAN_ROLLING_WINDOW_MS,
      resetTimeoutMs: env.CB_SOROBAN_RESET_TIMEOUT_MS,
      volumeThreshold: env.CB_SOROBAN_VOLUME_THRESHOLD,
      timeoutMs: env.CB_SOROBAN_TIMEOUT_MS,
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build an unsigned XDR for the escrow-lock contract invocation.
   *
   * @throws {AppError} 503 when the escrow contract id is not configured.
   * @throws {AppError} 503 when the Soroban RPC circuit is OPEN.
   * @throws {AppError} 404 when the delivery or payer account is not found.
   * @throws {AppError} 409 when the delivery status prevents locking.
   * @throws {AppError} 422 when the delivery carries no valid escrow amount.
   * @throws {AppError} 502 when the RPC simulation rejects the transaction.
   */
  public async buildEscrowLockXdr(input: EscrowLockXdrInput): Promise<EscrowLockXdrResult> {
    const contractId = this.requireEscrowContractId();
    const delivery = await deliveryService.getById(input.deliveryId);

    this.assertLockable(delivery);
    assertLockContractAsset(delivery.escrowAsset ?? { code: 'XLM' });
    const amount = this.resolveEscrowAmount(delivery);
    const stroops = this.toContractAmount(amount);

    const sourceAccount = await this.loadAccount(input.payerAddress);

    const operation = new Contract(contractId).call(
      stellarConfig.escrowLockFunction,
      new Address(input.payerAddress).toScVal(),
      nativeToScVal(this.escrowReference(delivery), { type: 'string' }),
      nativeToScVal(stroops, { type: 'i128' }),
    );

    const estimatedFee = estimateTransactionFee('escrow_lock', {
      amountStroops: stroops.toString(),
      reference: this.escrowReference(delivery),
    });
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: estimatedFee,
      networkPassphrase: stellarConfig.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(stellarConfig.transactionTimeoutSeconds)
      .build();

    const prepared = await this.prepare(transaction);

    logger.info(
      `[TransactionService] Escrow-lock XDR built — delivery=${String(delivery._id)} ` +
        `payer=${input.payerAddress} amount=${amount} stroops=${stroops.toString()} ` +
        `estimatedFee=${estimatedFee} appliedFee=${prepared.fee}`,
    );

    return {
      xdr: prepared.toXDR(),
      network: stellarConfig.network,
      networkPassphrase: stellarConfig.networkPassphrase,
      contractId,
      contractFunction: stellarConfig.escrowLockFunction,
      sourceAccount: input.payerAddress,
      sequence: prepared.sequence,
      fee: prepared.fee,
      validUntil: Number(prepared.timeBounds?.maxTime ?? 0),
      delivery: {
        id: String(delivery._id),
        deliveryId: delivery.deliveryId,
        trackingNumber: delivery.trackingNumber,
        status: delivery.status,
      },
      amount: {
        assetCode: delivery.escrowAsset?.code ?? 'XLM',
        value: amount,
        stroops: stroops.toString(),
        formatted: fromStroops(stroops),
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private requireEscrowContractId(): string {
    const contractId = stellarConfig.escrowContractId;
    if (!contractId) {
      logger.error('[TransactionService] SOROBAN_ESCROW_CONTRACT_ID is not configured');
      throw new AppError(
        'Escrow contract is not configured on this deployment.',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }
    return contractId;
  }

  private assertLockable(delivery: IDelivery): void {
    if (NON_LOCKABLE_STATUSES.has(delivery.status)) {
      throw new AppError(
        `Escrow cannot be locked for a delivery with status '${delivery.status}'.`,
        StatusCodes.CONFLICT,
      );
    }
  }

  private resolveEscrowAmount(delivery: IDelivery): number {
    const amount = delivery.escrowAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new AppError(
        'Delivery does not define a positive escrow amount.',
        StatusCodes.UNPROCESSABLE_ENTITY,
      );
    }
    return amount;
  }

  private toContractAmount(amount: number): bigint {
    try {
      return toStroops(amount);
    } catch (error) {
      throw new AppError(
        `Delivery escrow amount cannot be represented on-chain: ${extractMessage(error)}`,
        StatusCodes.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private escrowReference(delivery: IDelivery): string {
    return delivery.deliveryId?.trim() || String(delivery._id);
  }

  /**
   * Load the payer account via the circuit-breaker-protected RPC client.
   */
  private async loadAccount(payerAddress: string): Promise<Account> {
    return fireWithBreaker(
      this.breaker as CircuitBreaker<[() => Promise<Account>], Account>,
      (action: () => Promise<Account>) => action(),
      () => this.client.getAccount(payerAddress),
    ).catch((error: unknown) => {
      if (this.isCircuitOpen(error)) {
        throw new AppError(
          'Soroban RPC is temporarily unavailable.',
          StatusCodes.SERVICE_UNAVAILABLE,
        );
      }
      const rpcError = error as { code?: number; status?: number };
      const message = extractMessage(error);
      if (
        rpcError.code === 404 ||
        rpcError.status === 404 ||
        message.toLowerCase().includes('not found')
      ) {
        throw new AppError(
          `Account ${payerAddress} does not exist on ${stellarConfig.network}.`,
          StatusCodes.NOT_FOUND,
        );
      }
      logger.error(`[TransactionService] Failed to load payer account: ${message}`);
      throw new AppError(
        'Unable to load the payer account from Soroban RPC.',
        StatusCodes.BAD_GATEWAY,
      );
    });
  }

  private isCircuitOpen(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EOPEN';
  }

  /**
   * Simulate and assemble the transaction via the circuit-breaker-protected
   * RPC client.
   */
  private async prepare(transaction: Transaction): Promise<Transaction> {
    const result = await fireWithBreaker(
      this.breaker as CircuitBreaker<[() => Promise<Transaction>], Transaction>,
      (action: () => Promise<Transaction>) => action(),
      () => this.client.prepareTransaction(transaction),
    ).catch((error: unknown) => {
      if (this.isCircuitOpen(error)) {
        throw new AppError(
          'Soroban RPC is temporarily unavailable.',
          StatusCodes.SERVICE_UNAVAILABLE,
        );
      }
      const message = extractMessage(error);
      logger.error(`[TransactionService] Escrow-lock simulation failed: ${message}`);
      throw new AppError(
        `Soroban simulation failed for the escrow-lock invocation: ${message}`,
        StatusCodes.BAD_GATEWAY,
      );
    });

    return result;
  }
}

/** Singleton instance used by the controller layer. */
export const transactionService = new TransactionService();

// ─── EscrowTransactionBuilder (#333) ───────────────────────────────────────────

export interface EscrowAssetSpec {
  code: string;
  issuer?: string;
}

export interface EscrowPaymentBuildInput {
  sourceAccount: string;
  sequence: string;
  destination: string;
  /** Amount in stroops (integer bigint or numeric string) or decimal XLM/asset amount. */
  amountStroops: bigint | number | string;
  asset?: EscrowAssetSpec;
  memo?: string;
  fee?: string;
  timeoutSeconds?: number;
  networkPassphrase?: string;
}

export interface SequenceRetryResult<T> {
  result: T;
  attempts: number;
  finalSequence: string;
}

/**
 * Pure, deterministic Stellar transaction builder for escrow lifecycle
 * operations (`buildFund`, `buildRelease`, `buildRefund`), signature assembly
 * & verification, and `tx_bad_seq` retry handling (#333).
 */
export class EscrowTransactionBuilder {
  private readonly networkPassphrase: string;
  private readonly defaultFee: string;
  private readonly defaultTimeoutSeconds: number;

  constructor(options?: { networkPassphrase?: string; baseFee?: string; timeoutSeconds?: number }) {
    this.networkPassphrase = options?.networkPassphrase ?? stellarConfig.networkPassphrase;
    this.defaultFee = options?.baseFee ?? stellarConfig.baseFee;
    this.defaultTimeoutSeconds = options?.timeoutSeconds ?? stellarConfig.transactionTimeoutSeconds;
  }

  /** Build a funding transaction from payer to escrow account. */
  public buildFund(input: EscrowPaymentBuildInput): Transaction {
    return this.buildPaymentTx(input, 'escrow_fund');
  }

  /** Build a release transaction from escrow account to recipient/driver. */
  public buildRelease(input: EscrowPaymentBuildInput): Transaction {
    return this.buildPaymentTx(input, 'escrow_release');
  }

  /** Build a refund transaction from escrow account back to payer/merchant. */
  public buildRefund(input: EscrowPaymentBuildInput): Transaction {
    return this.buildPaymentTx(input, 'escrow_refund');
  }

  /**
   * Assemble signatures onto a transaction envelope using the supplied signers.
   * Rejects empty signer lists, invalid signers, or network-passphrase mismatches.
   */
  public signTransaction(
    transaction: Transaction,
    signers: Keypair[],
    expectedPassphrase?: string,
  ): Transaction {
    const passphrase = expectedPassphrase ?? this.networkPassphrase;
    if (transaction.networkPassphrase !== passphrase) {
      throw new AppError(
        `Network passphrase mismatch: expected '${passphrase}', got '${transaction.networkPassphrase}'.`,
        StatusCodes.BAD_REQUEST,
      );
    }

    if (!Array.isArray(signers) || signers.length === 0) {
      throw new AppError('At least one signer keypair is required.', StatusCodes.BAD_REQUEST);
    }

    for (const signer of signers) {
      if (
        !signer ||
        typeof signer.publicKey !== 'function' ||
        typeof signer.canSign !== 'function' ||
        !signer.canSign() ||
        !StrKey.isValidEd25519PublicKey(signer.publicKey())
      ) {
        throw new AppError('Invalid signer keypair provided.', StatusCodes.BAD_REQUEST);
      }
    }

    transaction.sign(...signers);
    return transaction;
  }

  /**
   * Verify that a signed transaction envelope carries a valid Ed25519 signature
   * matching `publicKey` over the transaction hash.
   */
  public verifySignature(transaction: Transaction, publicKey: string): boolean {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new AppError('Invalid signer public key.', StatusCodes.BAD_REQUEST);
    }
    if (transaction.networkPassphrase !== this.networkPassphrase) {
      throw new AppError(
        `Network passphrase mismatch: expected '${this.networkPassphrase}', got '${transaction.networkPassphrase}'.`,
        StatusCodes.BAD_REQUEST,
      );
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    const txHash = transaction.hash();
    const expectedHint = keypair.signatureHint();

    return transaction.signatures.some((sig) => {
      if (!Buffer.from(sig.hint()).equals(Buffer.from(expectedHint))) {
        return false;
      }
      return keypair.verify(txHash, sig.signature());
    });
  }

  /**
   * Execute a transaction submission with automatic rebuild on `tx_bad_seq`.
   * Fetches a fresh sequence number via `fetchFreshSequence` and rebuilds the
   * transaction before retrying.
   */
  public async submitWithSequenceRetry<T>(params: {
    initialSequence: string;
    build: (sequence: string) => Transaction;
    submit: (tx: Transaction) => Promise<T>;
    fetchFreshSequence: () => Promise<string>;
    maxRetries?: number;
  }): Promise<SequenceRetryResult<T>> {
    const maxRetries = Math.max(0, params.maxRetries ?? 2);
    let currentSequence = params.initialSequence;
    let attempts = 0;

    for (;;) {
      attempts += 1;
      const tx = params.build(currentSequence);
      try {
        const result = await params.submit(tx);
        return { result, attempts, finalSequence: currentSequence };
      } catch (error: unknown) {
        const isBadSeq = this.isBadSequenceError(error);
        if (!isBadSeq || attempts > maxRetries) {
          throw error;
        }
        currentSequence = await params.fetchFreshSequence();
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildPaymentTx(input: EscrowPaymentBuildInput, defaultMemo: string): Transaction {
    const passphrase = input.networkPassphrase ?? this.networkPassphrase;
    if (passphrase !== this.networkPassphrase) {
      throw new AppError(
        `Mismatched network passphrase: expected '${this.networkPassphrase}', got '${passphrase}'.`,
        StatusCodes.BAD_REQUEST,
      );
    }

    if (!StrKey.isValidEd25519PublicKey(input.sourceAccount)) {
      throw new AppError('Invalid source account public key.', StatusCodes.BAD_REQUEST);
    }
    if (!StrKey.isValidEd25519PublicKey(input.destination)) {
      throw new AppError('Invalid destination public key.', StatusCodes.BAD_REQUEST);
    }
    if (!/^\d+$/.test(String(input.sequence).trim())) {
      throw new AppError('Invalid sequence number.', StatusCodes.BAD_REQUEST);
    }

    const stroops = this.parsePositiveStroops(input.amountStroops);
    const amountDecimal = fromStroops(stroops);
    const asset = this.resolveAsset(input.asset);

    const account = new Account(input.sourceAccount, String(input.sequence).trim());
    const builder = new TransactionBuilder(account, {
      fee: input.fee ?? this.defaultFee,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.payment({
          destination: input.destination,
          asset,
          amount: amountDecimal,
        }),
      )
      .addMemo(Memo.text((input.memo ?? defaultMemo).slice(0, 28)))
      .setTimeout(input.timeoutSeconds ?? this.defaultTimeoutSeconds);

    return builder.build();
  }

  private parsePositiveStroops(raw: bigint | number | string): bigint {
    let stroops: bigint;
    if (typeof raw === 'bigint') {
      stroops = raw;
    } else if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
        throw new AppError('Amount in stroops must be a finite integer.', StatusCodes.BAD_REQUEST);
      }
      stroops = BigInt(raw);
    } else {
      const trimmed = raw.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        throw new AppError('Amount in stroops must be an integer string.', StatusCodes.BAD_REQUEST);
      }
      stroops = BigInt(trimmed);
    }

    if (stroops <= 0n) {
      throw new AppError('Transaction amount must be positive.', StatusCodes.BAD_REQUEST);
    }
    return stroops;
  }

  private resolveAsset(spec?: EscrowAssetSpec): Asset {
    if (!spec || spec.code.toUpperCase() === 'XLM' || spec.code.toLowerCase() === 'native') {
      return Asset.native();
    }
    if (!spec.issuer || !StrKey.isValidEd25519PublicKey(spec.issuer)) {
      throw new AppError(
        `Issued asset '${spec.code}' requires a valid Stellar issuer public key.`,
        StatusCodes.BAD_REQUEST,
      );
    }
    return new Asset(spec.code, spec.issuer);
  }

  private isBadSequenceError(error: unknown): boolean {
    const message = extractMessage(error).toLowerCase();
    if (message.includes('tx_bad_seq')) return true;
    if (typeof error === 'object' && error !== null) {
      const errObj = error as { resultCodes?: { transaction?: string }; code?: string };
      if (errObj.resultCodes?.transaction === 'tx_bad_seq') return true;
      if (errObj.code === 'tx_bad_seq') return true;
    }
    return false;
  }
}
