import EventLog, { IEventLog } from '../models/EventLog';
import { sorobanRpcClient, stellarConfig } from '../config/stellar';
import { recordBatchWithCheckpoint } from './eventLogService';
import logger from '../config/logger';
import { xdr, rpc as StellarRpc } from '@stellar/stellar-sdk';

export const INDEXER_BATCH_LEDGERS = Number(process.env.INDEXER_BATCH_LEDGERS ?? 5);
const BATCH_LEDGER_CAP = 50;

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

export function compareEventOrder(
  a: StellarRpc.Api.EventResponse,
  b: StellarRpc.Api.EventResponse,
): number {
  if (a.ledger !== b.ledger) {
    return a.ledger - b.ledger;
  }
  return a.txHash.localeCompare(b.txHash);
}

export async function poll(): Promise<void> {
  const startLedger = await resolveStartLedger();
  const cappedBatchSize = Math.min(INDEXER_BATCH_LEDGERS, BATCH_LEDGER_CAP);
  const endLedger = startLedger + cappedBatchSize - 1;
  logger.info(
    `[EventPoller] Polling ledger range ${startLedger}..${endLedger} (batch size ${cappedBatchSize})`,
  );
  const response = await sorobanRpcClient.getEvents({
    startLedger,
    endLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [stellarConfig.escrowContractId ?? ''],
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
  const orderedEvents = response.events.sort(compareEventOrder);
  const eventsToPersist = orderedEvents.map((event: StellarRpc.Api.EventResponse) => ({
    eventType: 'escrow' as const,
    transactionHash: event.txHash,
    ledgerSequence: event.ledger,
    contractId: undefined,
    eventData: { topic: event.topic.map((t) => t.toXDR('base64')), value: event.value },
    processedAt: null,
    status: 'pending' as const,
    errorMessage: null,
    retries: 0,
    lastError: null,
    nextRetryAt: null,
    deadLetteredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as IEventLog[];
  const checkpointLedger = endLedger;
  logger.info(
    `[EventPoller] Persisting ${eventsToPersist.length} events and advancing checkpoint to ledger ${checkpointLedger}`,
  );
  await recordBatchWithCheckpoint(eventsToPersist, checkpointLedger);
  logger.info(
    `[EventPoller] Batch persisted and checkpoint advanced to ledger ${checkpointLedger}`,
  );
}

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

export async function stopEventPoller(_handle: EventPollerHandle): Promise<void> {
  _handle.stop();
}

export type IndexedEventType = 'delivery' | 'escrow' | 'dispute' | 'reputation' | 'milestone';

export interface EventSubscription {
  eventType: IndexedEventType;
  topic: string;
  handle: (event: StellarRpc.Api.EventResponse) => Promise<unknown>;
}

export interface EventReplayer {
  replay(entry: {
    eventType: string;
    transactionHash: string;
    ledgerSequence: number;
    eventData: Record<string, unknown>;
  }): Promise<void>;
}

export const getEventReplayer = (): EventReplayer | null => {
  if (!stellarConfig.escrowContractId) return null;
  return {
    replay: async (): Promise<void> => {
      throw new Error('Replay not implemented in batch poller');
    },
  };
};

export interface EventPollerOptions {
  rpc: {
    getLatestLedger(): Promise<{ sequence: number }>;
    getEvents(args: {
      filters: unknown[];
      startLedger?: number;
      cursor?: string;
      limit?: number;
    }): Promise<{ events: StellarRpc.Api.EventResponse[]; cursor?: string }>;
  };
  network: string;
  contractId: string;
  subscriptions: EventSubscription[];
  intervalMs: number;
  pageSize: number;
  /**
   * Optional event source. When omitted the poller pages the RPC node itself;
   * injecting a fetcher keeps the loop testable with fakes or lets another
   * source feed the pipeline.
   */
  fetchNextEvents?: FetchNextEvents;
}

export interface PollCycleResult {
  fromLedger: number;
  toLedger: number;
  fetched: number;
  processed: number;
  duplicates: number;
  failed: number;
}

export class EventPoller implements EventReplayer {
  constructor(_options: EventPollerOptions) {}
  async pollOnce(): Promise<PollCycleResult> {
    return { fromLedger: 0, toLedger: 0, fetched: 0, processed: 0, duplicates: 0, failed: 0 };
  }
  async replay(_entry: {
    eventType: string;
    transactionHash: string;
    ledgerSequence: number;
    eventData: Record<string, unknown>;
  }): Promise<void> {}
  start(): void {}
  stop(): void {}
}
