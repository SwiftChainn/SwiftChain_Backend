import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { stellarConfig } from '../config/stellar';
import logger from '../config/logger';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';

const scalarSchema = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^\d+$/, 'value must be a non-negative integer'),
]);
const durationSchema = scalarSchema.refine(
  (value) => Number(value) >= 0,
  'duration must be non-negative',
);
const addressSchema = z
  .string()
  .refine(
    (value) => StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value),
    'address must be a valid Stellar account or contract address',
  );

export const escrowStateSchema = z.object({
  status: z.string().trim().min(1),
  balance: scalarSchema,
  owner: addressSchema.optional(),
  updatedAt: durationSchema.optional(),
});
export const deliveryStateSchema = z.object({
  status: z.string().trim().min(1),
  etaSeconds: durationSchema.optional(),
  updatedAt: durationSchema.optional(),
});
export const disputeStateSchema = z.object({
  status: z.string().trim().min(1),
  openedAt: durationSchema.optional(),
  resolvedAt: durationSchema.optional(),
});
export const reputationStateSchema = z.object({
  totalDeliveries: scalarSchema,
  successfulDeliveries: scalarSchema,
  averageRating: z.number().finite().min(0).max(5),
});

export type EscrowContractState = z.infer<typeof escrowStateSchema>;
export type DeliveryContractState = z.infer<typeof deliveryStateSchema>;
export type DisputeContractState = z.infer<typeof disputeStateSchema>;
export type ReputationContractState = z.infer<typeof reputationStateSchema>;

export class ContractStateNotFoundError extends Error {
  constructor() {
    super('The requested Soroban contract state entry does not exist.');
    this.name = 'ContractStateNotFoundError';
  }
}

export class ContractStateMalformedError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = 'ContractStateMalformedError';
  }
}

export class ContractStateReadError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = 'ContractStateReadError';
  }
}

interface CachedValue {
  expiresAt: number;
  value: Promise<unknown>;
}

const MAX_CACHE_ENTRIES = 1_000;

/** Convert XDR-native values to JSON-safe domain values without losing integer precision. */
export function normalizeSorobanValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (value instanceof Address) return value.toString();
  if (Array.isArray(value)) return value.map(normalizeSorobanValue);
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [
        String(normalizeSorobanValue(key)),
        normalizeSorobanValue(entry),
      ]),
    );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeSorobanValue(entry)]),
    );
  }
  return value;
}

/** Build a Soroban contract-data ledger key, defaulting to persistent storage. */
export function createContractDataLedgerKey(
  contractId: string,
  key: xdr.ScVal,
  durability: 'persistent' | 'temporary' = 'persistent',
): xdr.LedgerKey {
  if (!StrKey.isValidContract(contractId))
    throw new Error('contractId must be a valid contract address.');
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability:
        durability === 'persistent'
          ? xdr.ContractDataDurability.persistent()
          : xdr.ContractDataDurability.temporary(),
    }),
  );
}

/** Typed and cached reader for contract data entries returned by Soroban RPC. */
export class ContractStateService {
  private readonly client: ISorobanRpcClient;
  private readonly cache = new Map<string, CachedValue>();
  private readonly cacheTtlMs: number;

  constructor(
    client: ISorobanRpcClient = defaultSorobanRpcClient,
    cacheTtlMs = stellarConfig.sorobanStateCacheTtlMs,
  ) {
    if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300_000) {
      throw new Error('Contract state cache TTL must be between 0 and 300000 milliseconds.');
    }
    this.client = client;
    this.cacheTtlMs = cacheTtlMs;
  }

  public getEscrowState(key: xdr.LedgerKey): Promise<EscrowContractState> {
    return this.getState(key, 'escrow', escrowStateSchema);
  }

  public getDeliveryState(key: xdr.LedgerKey): Promise<DeliveryContractState> {
    return this.getState(key, 'delivery', deliveryStateSchema);
  }

  public getDisputeState(key: xdr.LedgerKey): Promise<DisputeContractState> {
    return this.getState(key, 'dispute', disputeStateSchema);
  }

  public getReputationState(key: xdr.LedgerKey): Promise<ReputationContractState> {
    return this.getState(key, 'reputation', reputationStateSchema);
  }

  /** Read the raw parsed ledger entry, distinguishing a missing key from RPC errors. */
  public async getLedgerEntry(key: xdr.LedgerKey): Promise<xdr.LedgerEntryData> {
    if (!this.client.getLedgerEntries) {
      throw new ContractStateReadError(
        'The configured Soroban RPC client does not support ledger entry reads.',
      );
    }
    let response;
    try {
      response = await this.client.getLedgerEntries(key);
    } catch (error) {
      logger.warn(
        `[ContractStateService] Ledger entry read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ContractStateReadError('Unable to read contract state from Soroban RPC.', error);
    }
    const entry = response.entries[0];
    if (!entry) throw new ContractStateNotFoundError();
    return entry.val;
  }

  private getState<T extends z.ZodTypeAny>(
    key: xdr.LedgerKey,
    kind: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const cacheKey = `${kind}:${key.toXDR('base64')}`;
    const existing = this.cache.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) return existing.value as Promise<z.infer<T>>;
    if (existing) this.cache.delete(cacheKey);

    const pending = this.readAndValidateState(key, schema);
    if (this.cacheTtlMs > 0) {
      while (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey === undefined) break;
        this.cache.delete(oldestKey);
      }
      const cached: CachedValue = { expiresAt: Date.now() + this.cacheTtlMs, value: pending };
      this.cache.set(cacheKey, cached);
      void pending.catch(() => {
        if (this.cache.get(cacheKey) === cached) this.cache.delete(cacheKey);
      });
    }
    return pending;
  }

  private async readAndValidateState<T extends z.ZodTypeAny>(
    key: xdr.LedgerKey,
    schema: T,
  ): Promise<z.infer<T>> {
    const ledgerEntry = await this.getLedgerEntry(key);
    let nativeValue: unknown;
    try {
      nativeValue = normalizeSorobanValue(scValToNative(ledgerEntry.contractData().val()));
    } catch (error) {
      throw new ContractStateMalformedError(
        'Ledger entry is not a decodable Soroban contract-data value.',
        error,
      );
    }
    const parsed = schema.safeParse(nativeValue);
    if (!parsed.success) {
      throw new ContractStateMalformedError(
        `Contract state failed validation: ${parsed.error.issues[0]?.message ?? 'invalid value'}.`,
        parsed.error,
      );
    }
    return parsed.data;
  }
}

export const contractStateService = new ContractStateService();
