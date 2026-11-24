import EventLog, { IEventLog } from '../models/EventLog';
import { sorobanRpcClient, stellarConfig } from '../config/stellar';
import { recordBatchWithCheckpoint } from './eventLogService';
import logger from '../config/logger';
import xdr from 'stellar-sdk';

export const INDEXER_BATCH_LEDGERS = Number(process.env.INDEXER_BATCH_LEDGERS ?? 5);

/**
 * Maximum number of ledgers fetched in a single polling pass.
 * Bounded to avoid runaway RPC requests if the environment variable is
 * misconfigured.
 */
const BATCH_LEDGER_CAP = 50;

interface SorobanEventResponse {
  ledger: number;
  index: number;
  txHash: string;
  topic: string;
  value: unknown;
}

/**
 * Resolve the ledger to start polling from.
 *
 * Uses the last successfully processed checkpoint from the event log. For a
 * fresh start the function returns the configured stellar network's initial
 * ledger with a logged warning.
 */
export async function resolveStartLedger(): Promise<number> {
  const lastFromEventLog = await EventLog.findOne(
    {},
    { ledgerSequence: 1 },
    { sort: { ledgerSequence: -1 }, lean: true },
  );

  if (!lastFromEventLog) {
    logger.warn(
      `[EventPoller] No event log entries found; starting from stellar network initial ledger ${stellarConfig.initialLedger}`,
    );
    return stellarConfig.initialLedger;
  }

  logger.debug(
    `[EventPoller] Resolved start ledger from event log: ${lastFromEventLog.ledgerSequence + 1}`,
  );
  return lastFromEventLog.ledgerSequence + 1;
}

/**
 * Compare two Soroban events for deterministic ascending dispatch order.
 *
 * Primary sort: ledger ascending. Secondary sort: event index ascending.
 * Ties on both fields are considered equal to avoid arbitrary reordering.
 */
export function compareEventOrder(a: SorobanEventResponse, b: SorobanEventResponse): number {
  if (a.ledger !== b.ledger) {
    return a.ledger - b.ledger;
  }
  const aIndex = Number(a.index ?? 0);
  const bIndex = Number(b.index ?? 0);
  if (aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  return 0;
}

/**
 * Single polling pass: fetch a bounded ledger range, order events deterministically,
 * persist them, and advance the checkpoint atomically.
 */
export async function poll(): Promise<void> {
  const startLedger = await resolveStartLedger();
  const cappedBatchSize = Math.min(INDEXER_BATCH_LEDGERS, BATCH_LEDGER_CAP);
  const endLedger = startLedger + cappedBatchSize - 1;

  logger.info(
    `[EventPoller] Polling ledger range ${startLedger}..${endLedger} ` +
      `(batch size ${cappedBatchSize})`,
  );

  const response = await sorobanRpcClient.getEvents({
    startLedger,
    endLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [stellarConfig.sorobanContractId ?? ''],
        topics: [[xdr.ScVal.scvSymbol('escrow_funded').toXDR('base64'), '*']],
      },
    ],
  });

  if (response.events.length === 0) {
    logger.info(
      `[EventPoller] No events in ledger range ${startLedger}..${endLedger} — checkpoint unchanged`,
    );
    return;
  }

  // Deterministic dispatch order: ascending (ledger, eventIndex).
  const orderedEvents = response.events.toArray().sort(compareEventOrder);

  const eventsToPersist: IEventLog[] = orderedEvents.map((event: StellarRpc.Api.EventResponse) => ({
    eventType: 'escrow' as const,
    transactionHash: event.txHash,
    ledgerSequence: event.ledger,
    contractId: undefined,
    eventData: { topic: event.topic, value: event.value },
  }));

  const checkpointLedger = endLedger;

  logger.info(
    `[EventPoller] Persisting ${eventsToPersist.length} events and advancing checkpoint to ledger ${checkpointLedger}`,
  );

  await recordBatchWithCheckpoint(eventsToPersist, checkpointLedger);

  logger.info(
    `[EventPoller] Batch persisted and checkpoint advanced to ledger ${checkpointLedger}`,
  );
}

/**
 * Start the batch event poller.
 *
 * Spawns a polling interval using the configured stellar network. The returned
 * handle can be used to stop polling when the process shuts down.
 */
export interface EventPollerHandle {
  stop(): void;
}

export async function startEventPoller(): Promise<EventPollerHandle> {
  logger.info('[EventPoller] Starting batch event poller');

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    try {
      await poll();
    } catch (error) {
      logger.error('[EventPoller] Polling tick failed', { error });
    }
  };

  await tick();
  intervalId = setInterval(tick, 1000);

  return {
    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      logger.info('[EventPoller] Stopped polling');
    },
  };
}

/**
 * Stop the batch event poller.
 */
export async function stopEventPoller(_handle: EventPollerHandle): Promise<void> {
  _handle.stop();
}

// Re-export types for consumers that need them.
export type { SorobanEventResponse };
