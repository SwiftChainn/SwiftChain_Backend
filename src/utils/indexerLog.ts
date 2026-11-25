/**
 * indexerLog.ts
 *
 * Structured logging for the contract-event indexer. Every line carries the
 * same four context fields — `ledgerSeq`, `eventType`, `contractId` and
 * `entityId` — so operators can filter and trace a ledger range or a single
 * event across ingestion, dispatch, dedupe, failure and checkpoint lines.
 *
 * Fields that do not apply to a line (for example `entityId` on a checkpoint
 * advance) are logged as `null` rather than omitted, so the log shape is
 * stable and queries such as `ledgerSeq >= N` never miss a record because a
 * key was absent.
 */

import { rpc as StellarRpc, scValToNative } from '@stellar/stellar-sdk';
import logger from '../config/logger';

/** Log levels used by the indexer. Routine per-event lines use `debug`. */
export type IndexerLogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Context the caller knows about the line being logged. */
export interface IndexerLogContext {
  ledgerSeq?: number | null;
  eventType?: string | null;
  contractId?: string | null;
  /** Domain entity the event concerns, e.g. the delivery id. */
  entityId?: string | null;
}

/** The normalised context attached to every indexer log record. */
export interface IndexerLogFields {
  ledgerSeq: number | null;
  eventType: string | null;
  contractId: string | null;
  entityId: string | null;
}

/** Additional, line-specific metadata (counts, tx hash, error message…). */
export type IndexerLogExtra = Record<string, string | number | boolean | null | undefined>;

/** Normalise a partial context into the fixed indexer log shape. */
export function indexerLogFields(context: IndexerLogContext): IndexerLogFields {
  return {
    ledgerSeq: context.ledgerSeq ?? null,
    eventType: context.eventType ?? null,
    contractId: context.contractId ?? null,
    entityId: context.entityId ?? null,
  };
}

/**
 * Write one indexer log line with the standard context fields.
 *
 * The context is written after `extra`, so line-specific metadata can never
 * overwrite the four fields operators filter on.
 */
export function indexerLog(
  level: IndexerLogLevel,
  message: string,
  context: IndexerLogContext,
  extra: IndexerLogExtra = {},
): void {
  logger[level](message, { ...extra, ...indexerLogFields(context) });
}

/**
 * Derive the entity id of a contract event from its second topic, which by
 * SwiftChain contract convention is the entity key (e.g. `delivery_id` in
 * `(escrow_funded, delivery_id)`). Returns `null` when the event carries no
 * such topic or it does not decode to a scalar.
 */
export function entityIdFromEvent(event: StellarRpc.Api.EventResponse): string | null {
  const keyTopic = event.topic[1];
  if (!keyTopic) return null;

  try {
    const value: unknown = scValToNative(keyTopic);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
  } catch {
    // An undecodable topic is not an indexing failure; the line is still logged.
  }
  return null;
}
