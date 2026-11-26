import EventLog, { IEventLog } from '../models/EventLog';
import { sorobanRpcClient, stellarConfig } from '../config/stellar';
import { recordBatchWithCheckpoint } from './eventLogService';
import logger from '../config/logger';
import { nextEventLogRetryAt } from '../utils/eventLogBackoff';
import { computeEventHashFromRpcEvent } from '../utils/eventHash';
import { handleEscrowFundedEvent } from '../indexer/escrowHandlers';
import { eventCorrelationService, extractEntityFromRpcEvent } from './eventCorrelationService';
import type { ISorobanRpcClient, SorobanGetEventsRequest } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';

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
  /** Validate decoded payloads with Zod before handler dispatch. Default: true. */
  validatePayloads?: boolean;
  /** Optional pause predicate (defaults to ContractAbiService hard-mismatch pause state). */
  isPaused?: () => boolean;
}

export interface PollCycleResult {
  fromLedger: number;
  toLedger: number;
  fetched: number;
  processed: number;
  duplicates: number;
  failed: number;
}

type EventOutcome = 'processed' | 'duplicates' | 'failed';

/** The parts of an EventLog entry needed to find and re-dispatch its event. */
export type ReplayableEvent = Pick<
  IEventLog,
  'eventType' | 'transactionHash' | 'ledgerSequence' | 'eventData'
>;

/** Re-dispatches a recorded event; implemented by {@link EventPoller.replay}. */
export interface EventReplayer {
  replay(entry: ReplayableEvent): Promise<void>;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_PAGE_SIZE = 100;

/** Topic filter key as the RPC node expects it: the base64 XDR of the symbol. */
const topicKey = (topic: string): string => xdr.ScVal.scvSymbol(topic).toXDR('base64');

// ─── Poller ────────────────────────────────────────────────────────────────────

export class EventPoller implements EventReplayer {
  private readonly options: EventPollerOptions;
  private readonly subscriptionsByTopic: Map<string, EventSubscription>;
  private readonly filters: SorobanGetEventsRequest['filters'];
  private readonly validatePayloads: boolean;
  private readonly isPaused: () => boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: EventPollerOptions) {
    this.options = options;
    this.validatePayloads = options.validatePayloads ?? true;
    this.isPaused = options.isPaused ?? ((): boolean => contractAbiService.isIngestionPaused());
    this.subscriptionsByTopic = new Map(
      options.subscriptions.map((subscription) => [topicKey(subscription.topic), subscription]),
    );
    this.filters = options.subscriptions.map((subscription) => ({
      type: 'contract',
      contractIds: [options.contractId],
      topics: [[topicKey(subscription.topic), '*']],
    }));
  }

  /** Begin polling on the configured interval. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.options.intervalMs);
    void this.runCycle();
  }

  /** Stop scheduling new cycles. A cycle already in flight runs to completion. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Run one poll cycle. Errors propagate to the caller and leave the
   * checkpoint untouched, so the same ledgers are retried on the next cycle.
   */
  async pollOnce(): Promise<PollCycleResult> {
    const { network, rpc } = this.options;

    if (this.isPaused()) {
      const checkpoint = await IndexerStatus.findOne({ network }).lean();
      const ledger = checkpoint?.lastProcessedLedger ?? 0;
      logger.warn(
        `[EventPoller] Ingestion paused due to contract ABI mismatch — network=${network} ` +
          `checkpoint=${ledger}`,
      );
      return {
        fromLedger: ledger,
        toLedger: ledger,
        fetched: 0,
        processed: 0,
        duplicates: 0,
        failed: 0,
      };
    }

    const latest = await rpc.getLatestLedger();
    const toLedger = latest.sequence;

    const checkpoint = await IndexerStatus.findOne({ network }).lean();
    // With no checkpoint yet, begin at the head rather than replaying history.
    const fromLedger = checkpoint ? checkpoint.lastProcessedLedger + 1 : toLedger;

    const result: PollCycleResult = {
      fromLedger,
      toLedger,
      fetched: 0,
      processed: 0,
      duplicates: 0,
      failed: 0,
    };

    if (fromLedger > toLedger) return result;

    for await (const event of this.fetchEvents(fromLedger, toLedger)) {
      result.fetched += 1;

      const subscription = this.subscriptionForEvent(event);
      if (!subscription) continue;

      const outcome = await this.ingest(subscription, event);
      result[outcome] += 1;
    }

    await IndexerStatus.updateOne(
      { network },
      { $set: { lastProcessedLedger: toLedger, lastProcessedAt: new Date() } },
      { upsert: true },
    );

    logger.info(
      `[EventPoller] Cycle complete — network=${network} ledgers=${fromLedger}-${toLedger} ` +
        `fetched=${result.fetched} processed=${result.processed} ` +
        `duplicates=${result.duplicates} failed=${result.failed}`,
    );

    return result;
  }

  /**
   * Re-run one recorded event through the handler registered for its topic —
   * the same dispatch path {@link ingest} uses — without touching its EventLog
   * entry; the caller owns the outcome. EventLog keeps only a reference to the
   * event, so it is fetched back from the RPC node by ledger and event id.
   *
   * @throws when the node no longer serves the event (outside its retention
   *         window), when no subscription handles its topic, or when the
   *         handler itself throws.
   */
  async replay(entry: ReplayableEvent): Promise<void> {
    const event = await this.findRecordedEvent(entry);
    if (!event) {
      throw new Error(
        `Event for tx=${entry.transactionHash} is no longer available at ledger ${entry.ledgerSequence}`,
      );
    }

    const subscription = this.subscriptionForEvent(event);
    if (!subscription || subscription.eventType !== entry.eventType) {
      throw new Error(
        `No ${entry.eventType} subscription handles the event for tx=${entry.transactionHash}`,
      );
    }

    this.guardEventPayload(subscription, event);
    await subscription.handle(event);
  }

  /** Validate a decoded Soroban event against its registered Zod schema before dispatch. */
  private guardEventPayload(
    subscription: EventSubscription,
    event: StellarRpc.Api.EventResponse,
  ): void {
    if (!this.validatePayloads || subscription.eventType === 'milestone') {
      return;
    }

    const family = subscription.eventType as EventFamily;
    if (!getEventPayloadSchema(family, subscription.topic)) {
      return;
    }

    validateSorobanEventPayload(family, subscription.topic, event);
  }

  /** Find the event an EventLog entry recorded, matching on event id when one was stored. */
  private async findRecordedEvent(
    entry: ReplayableEvent,
  ): Promise<StellarRpc.Api.EventResponse | null> {
    const eventId = (entry.eventData as { eventId?: string } | null | undefined)?.eventId;

    for await (const event of this.fetchEvents(entry.ledgerSequence, entry.ledgerSequence)) {
      const matches = eventId ? event.id === eventId : event.txHash === entry.transactionHash;
      if (matches) return event;
    }
    return null;
  }

  /** Page through `getEvents` from `fromLedger`, yielding events up to `toLedger`. */
  private async *fetchEvents(
    fromLedger: number,
    toLedger: number,
  ): AsyncGenerator<StellarRpc.Api.EventResponse> {
    const { rpc, pageSize } = this.options;
    let cursor: string | undefined;

    for (;;) {
      const page = await rpc.getEvents(
        cursor
          ? { filters: this.filters, cursor, limit: pageSize }
          : { filters: this.filters, startLedger: fromLedger, limit: pageSize },
      );

      if (page.events.length === 0) return;

      for (const event of page.events) {
        // Events arrive in ledger order, so the first event past the window ends the cycle.
        if (event.ledger > toLedger) return;
        yield event;
      }

      // A cursor that does not advance would page forever.
      if (page.cursor === cursor) return;
      cursor = page.cursor;
    }
  }

  private subscriptionForEvent(event: StellarRpc.Api.EventResponse): EventSubscription | undefined {
    const first = event.topic[0];
    return first ? this.subscriptionsByTopic.get(first.toXDR('base64')) : undefined;
  }

  /**
   * Record one event and dispatch it to its handler.
   *
   * A record already marked processed or failed is skipped. A record left
   * `pending` by an interrupted earlier cycle is processed again, which is why
   * handlers must be idempotent.
   */
  private async ingest(
    subscription: EventSubscription,
    event: StellarRpc.Api.EventResponse,
  ): Promise<EventOutcome> {
    const { eventType, handle } = subscription;
    const transactionHash = event.txHash;
    const eventHash = computeEventHashFromRpcEvent(event, this.options.contractId);

    const { event: record, replayed } = await EventLog.recordOrReplay({
      eventType,
      transactionHash,
      ledgerSequence: event.ledger,
      contractId: this.options.contractId,
      eventHash,
      eventData: { eventId: event.id, ledgerClosedAt: event.ledgerClosedAt },
      status: 'pending',
    });

    if (replayed && record.status !== 'pending') return 'duplicates';

    try {
      await handle(event);
      await EventLog.updateOne(
        { _id: record._id },
        { $set: { status: 'processed', processedAt: new Date(), eventHash } },
      );

      // Populate the event correlation index for tx/ledger -> off-chain entity lookups (#334).
      const target = extractEntityFromRpcEvent(eventType, event);
      if (target) {
        await eventCorrelationService.recordCorrelation({
          contractId: this.options.contractId,
          transactionHash,
          ledgerSequence: event.ledger,
          eventType,
          eventHash,
          eventLogId: record._id,
          topic: target.topic ?? subscription.topic,
          entityType: target.entityType,
          entityId: target.entityId,
          metadata: { eventId: event.id, ledgerClosedAt: event.ledgerClosedAt },
        });
      }

      return 'processed';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await EventLog.updateOne(
        { _id: record._id },
        {
          status: 'failed',
          errorMessage,
          lastError: errorMessage,
          nextRetryAt: nextEventLogRetryAt(1),
        },
      );
      if (error instanceof EventPayloadValidationError) {
        logger.error('[EventPoller] Event payload validation failed — skipping handler dispatch', {
          eventType,
          topic: subscription.topic,
          transactionHash,
          ledger: event.ledger,
          issues: error.issues,
          error: errorMessage,
        });
      } else {
        logger.error(
          `[EventPoller] Handler failed — type=${eventType} tx=${transactionHash} ` +
            `ledger=${event.ledger} error="${errorMessage}"`,
        );
      }
      return 'failed';
    }
  }

  /** Run a cycle unless one is already in flight, and log instead of throwing. */
  private runCycle(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.pollOnce()
        .then(
          () => undefined,
          (error: unknown) => {
            logger.error(
              `[EventPoller] Cycle failed — error="${
                error instanceof Error ? error.message : String(error)
              }"`,
            );
          },
        )
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
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
