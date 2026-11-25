import { assertLockContractAsset } from './currencyService';
import { Account, Transaction } from '@stellar/stellar-sdk';
import { StatusCodes } from 'http-status-codes';
import CircuitBreaker from 'opossum';
import { stellarConfig } from '../config/stellar';
import { deliveryService } from './delivery.service';
import { DeliveryStatus, IDelivery } from '../models/Delivery';
import { fromStroops } from '../utils/stroops';
import AppError from '../utils/AppError';
import logger from '../config/logger';
import env from '../config/env';
import { createCircuitBreaker, fireWithBreaker } from '../utils/circuitBreaker';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';
import { EscrowTransactionBuilder } from './escrowTransactionBuilder';

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
  private readonly builder: EscrowTransactionBuilder;

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

    this.builder = new EscrowTransactionBuilder({
      loadAccount: (address: string): Promise<Account> => this.loadAccount(address),
      prepare: (transaction: Transaction): Promise<Transaction> => this.prepare(transaction),
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
    const delivery = await deliveryService.getById(input.deliveryId);

    this.assertLockable(delivery);
    assertLockContractAsset(delivery.escrowAsset ?? { code: 'XLM' });
    const amount = Number(delivery.escrowAmount);

    const envelope = await this.builder.buildFund({
      payerAddress: input.payerAddress,
      escrowReference: this.escrowReference(delivery),
      amount,
    });
    const { transaction: prepared, stroops } = envelope;

    logger.info(
      `[TransactionService] Escrow-lock XDR built — delivery=${String(delivery._id)} ` +
        `payer=${input.payerAddress} amount=${amount} stroops=${stroops.toString()} ` +
        `fee=${prepared.fee}`,
    );

    return {
      xdr: envelope.xdr,
      network: stellarConfig.network,
      networkPassphrase: envelope.networkPassphrase,
      contractId: envelope.contractId,
      contractFunction: envelope.contractFunction,
      sourceAccount: envelope.sourceAccount,
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

  private assertLockable(delivery: IDelivery): void {
    if (NON_LOCKABLE_STATUSES.has(delivery.status)) {
      throw new AppError(
        `Escrow cannot be locked for a delivery with status '${delivery.status}'.`,
        StatusCodes.CONFLICT,
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
