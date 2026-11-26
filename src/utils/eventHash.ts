/**
 * Deterministic content-addressed event hashing for Soroban contract events (#336).
 *
 * Computes a stable SHA-256 hex digest from:
 *   (contractId, topic, payload) + ledgerContext
 *
 * Canonical serialization sorts object keys recursively and converts BigInts to
 * strings so identical events always produce the exact same hash across process
 * restarts, retries, and differing JS property orders.
 */

import crypto from 'crypto';
import { rpc as StellarRpc } from '@stellar/stellar-sdk';

export interface EventLedgerContext {
  ledgerSequence: number;
  transactionHash: string;
  eventId?: string;
}

export interface EventHashInput {
  contractId: string;
  topic: string | string[];
  payload: unknown;
  ledgerContext: EventLedgerContext;
}

/**
 * Recursively normalize a value into a deterministic JSON-safe structure
 * (sorted object keys, BigInt -> string, undefined omitted in objects).
 */
export function canonicalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map((item) => canonicalizeForHash(item));
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [key, val] of entries) {
      if (val !== undefined) {
        sorted[key] = canonicalizeForHash(val);
      }
    }
    return sorted;
  }
  return String(value);
}

/**
 * Compute a stable SHA-256 event hash from `(contractId, topic, payload)` and
 * `ledgerContext`.
 */
export function computeEventHash(input: EventHashInput): string {
  const normalizedTopic = Array.isArray(input.topic) ? input.topic : [input.topic];
  const canonicalPayload = canonicalizeForHash({
    contractId: input.contractId.trim(),
    topic: normalizedTopic,
    payload: input.payload,
    ledgerContext: {
      ledgerSequence: input.ledgerContext.ledgerSequence,
      transactionHash: input.ledgerContext.transactionHash.trim(),
      ...(input.ledgerContext.eventId ? { eventId: input.ledgerContext.eventId.trim() } : {}),
    },
  });

  return crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
}

/**
 * Compute a stable `eventHash` directly from a Soroban RPC `EventResponse`
 * at decode time.
 */
export function computeEventHashFromRpcEvent(
  event: StellarRpc.Api.EventResponse,
  fallbackContractId = '',
): string {
  const contractId =
    typeof event.contractId === 'string'
      ? event.contractId
      : event.contractId &&
          typeof (event.contractId as { contractId?: () => string }).contractId === 'function'
        ? (event.contractId as { contractId: () => string }).contractId()
        : fallbackContractId;

  const topics = Array.isArray(event.topic)
    ? event.topic.map((t) => (typeof t === 'string' ? t : t.toXDR('base64')))
    : [];

  const payload =
    event.value &&
    typeof (event.value as { toXDR?: (format: string) => string }).toXDR === 'function'
      ? (event.value as { toXDR: (format: string) => string }).toXDR('base64')
      : event.value ?? null;

  return computeEventHash({
    contractId,
    topic: topics,
    payload,
    ledgerContext: {
      ledgerSequence: event.ledger,
      transactionHash: event.txHash,
      eventId: event.id,
    },
  });
}
