/**
 * escrowTransactionBuilder.ts
 *
 * Assembles Soroban transactions for the escrow lifecycle (fund, release,
 * refund) in one place, independently of how they are submitted.
 *
 * Responsibilities:
 *   - Argument encoding for each escrow contract function.
 *   - Sequencing: the source account (and so its sequence number) is always
 *     loaded fresh from the network at build time, so calling a build method
 *     again is the `tx_bad_seq` recovery path.
 *   - Fee application: every envelope starts from the configured base fee and
 *     is then simulated, which attaches resource fees and the footprint.
 *   - Signing: when a signer is supplied it must match the source account;
 *     otherwise the envelope is returned unsigned for a client wallet.
 *
 * RPC access is injected, so each caller keeps its own resilience policy
 * (circuit breaker, retry) and error mapping, and the builder stays unit
 * testable without a network.
 */

import {
  Account,
  Address,
  Contract,
  Keypair,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { StatusCodes } from 'http-status-codes';
import { stellarConfig } from '../config/stellar';
import AppError from '../utils/AppError';
import { toStroops } from '../utils/stroops';

// ─── Errors ────────────────────────────────────────────────────────────────────

/** Reasons a build request can be rejected before anything reaches the network. */
export type EscrowTransactionBuildErrorCode =
  | 'MISSING_CONTRACT'
  | 'INVALID_AMOUNT'
  | 'INVALID_ADDRESS'
  | 'INVALID_REFERENCE'
  | 'WRONG_SIGNER';

const STATUS_BY_CODE: Record<EscrowTransactionBuildErrorCode, number> = {
  MISSING_CONTRACT: StatusCodes.SERVICE_UNAVAILABLE,
  INVALID_AMOUNT: StatusCodes.UNPROCESSABLE_ENTITY,
  INVALID_ADDRESS: StatusCodes.BAD_REQUEST,
  INVALID_REFERENCE: StatusCodes.UNPROCESSABLE_ENTITY,
  WRONG_SIGNER: StatusCodes.FORBIDDEN,
};

/** Typed validation failure raised by {@link EscrowTransactionBuilder}. */
export class EscrowTransactionBuildError extends AppError {
  public readonly code: EscrowTransactionBuildErrorCode;

  constructor(code: EscrowTransactionBuildErrorCode, message: string) {
    super(message, STATUS_BY_CODE[code]);
    this.code = code;
    this.name = 'EscrowTransactionBuildError';
    // AppError pins its own prototype; restore ours so `instanceof` works.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

/** The escrow lifecycle actions the builder can encode. */
export type EscrowAction = 'fund' | 'release' | 'refund';

/** RPC operations the builder needs, supplied by the calling service. */
export interface EscrowTransactionRpc {
  /** Load the source account with its current sequence number. */
  loadAccount(address: string): Promise<Account>;
  /** Simulate the transaction and attach resource fees and footprint. */
  prepare(transaction: Transaction): Promise<Transaction>;
}

interface EscrowBuildBase {
  /** Escrow reference the contract stores funds under (delivery business key). */
  escrowReference: string;
  /** Optional signer; must be the source account of the transaction. */
  signer?: Keypair;
}

export interface BuildFundInput extends EscrowBuildBase {
  /** Account that funds the escrow; also the transaction source. */
  payerAddress: string;
  /** Amount in asset units (not stroops). */
  amount: number;
}

export interface BuildSettlementInput extends EscrowBuildBase {
  /**
   * Account authorising the settlement and acting as transaction source:
   * the recipient (release), the sender (refund), or the contract admin.
   */
  callerAddress: string;
}

/** A built escrow transaction, signed when a signer was supplied. */
export interface EscrowTransactionEnvelope {
  action: EscrowAction;
  transaction: Transaction;
  /** Base64 transaction envelope XDR. */
  xdr: string;
  signed: boolean;
  contractId: string;
  contractFunction: string;
  networkPassphrase: string;
  sourceAccount: string;
  sequence: string;
  fee: string;
}

/** A built funding transaction, with the amount it encodes. */
export interface EscrowFundEnvelope extends EscrowTransactionEnvelope {
  /** Contract amount in stroops. */
  stroops: bigint;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

export class EscrowTransactionBuilder {
  constructor(private readonly rpc: EscrowTransactionRpc) {}

  /** Build the escrow funding (lock) invocation: `(payer, reference, amount)`. */
  async buildFund(input: BuildFundInput): Promise<EscrowFundEnvelope> {
    const payer = this.requireAccountAddress(input.payerAddress, 'payer');
    const stroops = this.toContractAmount(input.amount);

    const envelope = await this.build('fund', stellarConfig.escrowLockFunction, payer, input, [
      new Address(payer).toScVal(),
      this.referenceArg(input.escrowReference),
      nativeToScVal(stroops, { type: 'i128' }),
    ]);
    return { ...envelope, stroops };
  }

  /** Build the escrow release invocation: `(caller, reference)`. */
  async buildRelease(input: BuildSettlementInput): Promise<EscrowTransactionEnvelope> {
    return this.buildSettlement('release', stellarConfig.escrowReleaseFunction, input);
  }

  /** Build the escrow refund invocation: `(caller, reference)`. */
  async buildRefund(input: BuildSettlementInput): Promise<EscrowTransactionEnvelope> {
    return this.buildSettlement('refund', stellarConfig.escrowRefundFunction, input);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private buildSettlement(
    action: EscrowAction,
    contractFunction: string,
    input: BuildSettlementInput,
  ): Promise<EscrowTransactionEnvelope> {
    const caller = this.requireAccountAddress(input.callerAddress, 'caller');
    return this.build(action, contractFunction, caller, input, [
      new Address(caller).toScVal(),
      this.referenceArg(input.escrowReference),
    ]);
  }

  private async build(
    action: EscrowAction,
    contractFunction: string,
    source: string,
    input: EscrowBuildBase,
    args: xdr.ScVal[],
  ): Promise<EscrowTransactionEnvelope> {
    const contractId = this.requireContractId();
    // Checked before any RPC call so a misconfigured signer never costs a simulation.
    if (input.signer && input.signer.publicKey() !== source) {
      throw new EscrowTransactionBuildError(
        'WRONG_SIGNER',
        `Signer ${input.signer.publicKey()} cannot sign an escrow ${action} sourced from ${source}.`,
      );
    }

    const account = await this.rpc.loadAccount(source);

    const transaction = new TransactionBuilder(account, {
      fee: stellarConfig.baseFee,
      networkPassphrase: stellarConfig.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(contractFunction, ...args))
      .setTimeout(stellarConfig.transactionTimeoutSeconds)
      .build();

    const prepared = await this.rpc.prepare(transaction);
    if (input.signer) prepared.sign(input.signer);

    return {
      action,
      transaction: prepared,
      xdr: prepared.toXDR(),
      signed: input.signer !== undefined,
      contractId,
      contractFunction,
      networkPassphrase: stellarConfig.networkPassphrase,
      sourceAccount: source,
      sequence: prepared.sequence,
      fee: prepared.fee,
    };
  }

  private requireContractId(): string {
    const contractId = stellarConfig.escrowContractId;
    if (!contractId) {
      throw new EscrowTransactionBuildError(
        'MISSING_CONTRACT',
        'Escrow contract is not configured on this deployment.',
      );
    }
    return contractId;
  }

  private requireAccountAddress(address: string, role: string): string {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new EscrowTransactionBuildError(
        'INVALID_ADDRESS',
        `The ${role} must be a valid Stellar account public key.`,
      );
    }
    return address;
  }

  private referenceArg(reference: string): xdr.ScVal {
    const trimmed = reference.trim();
    if (!trimmed) {
      throw new EscrowTransactionBuildError(
        'INVALID_REFERENCE',
        'An escrow reference is required to build the transaction.',
      );
    }
    return nativeToScVal(trimmed, { type: 'string' });
  }

  private toContractAmount(amount: number): bigint {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new EscrowTransactionBuildError(
        'INVALID_AMOUNT',
        'Delivery does not define a positive escrow amount.',
      );
    }
    try {
      return toStroops(amount);
    } catch (error) {
      throw new EscrowTransactionBuildError(
        'INVALID_AMOUNT',
        `Delivery escrow amount cannot be represented on-chain: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
