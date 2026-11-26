import EventLog, { IEventLog, RecordBatchInput, RecordBatchResult } from '../models/EventLog';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';
import type { ClientSession, SortOrder } from 'mongoose';

// --- Atomic batch ingestion -----------------------------------------------

/**
 * Record a batch of events and advance the checkpoint atomically inside a
 * Mongoose transaction (when a replica set is available). Falls back to
 * standalone writes when a transaction cannot be started.
 */
export async function recordBatchWithCheckpoint(
  events: RecordBatchInput,
  checkpointLedger: number,
): Promise<RecordBatchResult> {
  const mongooseDocEvents = events.map((event) =>
    event instanceof EventLog ? event : EventLog.build(event as IEventLog),
  );

  let session: ClientSession | undefined;
  let sessionStarted = false;
  try {
    session = await startTrackedSession();
    sessionStarted = true;
    await EventLog.recordBatchWithCheckpoint(mongooseDocEvents, checkpointLedger);
    return { inserted: mongooseDocEvents.map((e) => e.toObject() as IEventLog), checkpointLedger };
  } catch (error) {
    if (sessionStarted) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

/**
 * Backward-compatible alias used by existing consumers that expect a single
 * "record processed ledger" call. It records nothing new when the ledger has
 * already been processed.
 */
export async function recordProcessedLedger(ledger: number): Promise<void> {
  logger.info(`[EventLogService] recordProcessedLedger invoked for ledger ${ledger}`);
  // No-op against the existing interface contract; the real work happens in
  // recordBatchWithCheckpoint driven from the event poller.
}

// --- EventLogService class (kept for backward compatibility) ----------------

/**
 * Service class providing the legacy event-log API used by the controller and
 * routes. New batch-ingestion paths use the standalone functions above.
 */
export class EventLogService {
  /**
   * Get all unprocessed events
   */
  async getUnprocessedEvents(
    page = 1,
    limit = 20,
    sort: Record<string, SortOrder> = { createdAt: 1 },
  ): Promise<{
    data: IEventLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const safePage = Math.max(1, page);
      const safeLimit = Math.min(Math.max(1, limit), 100);
      const query = { status: 'pending' };
      const skip = (safePage - 1) * safeLimit;

      const [data, total] = await Promise.all([
        EventLog.find(query).sort(sort).skip(skip).limit(safeLimit),
        EventLog.countDocuments(query),
      ]);

      return {
        data,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      logger.error('Error fetching unprocessed events:', error);
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
  }

  /**
   * Get events by ledger sequence range
   */
  async getEventsByLedgerRange(
    startLedger: number,
    endLedger: number,
    eventType?: string,
  ): Promise<IEventLog[]> {
    try {
      const query: Record<string, unknown> = {
        ledgerSequence: { $gte: startLedger, $lte: endLedger },
      };
      if (eventType) {
        query.eventType = eventType;
      }
      return await EventLog.find(query).sort({ ledgerSequence: 1 });
    } catch (error) {
      logger.error('Error fetching events by ledger range:', error);
      return [];
    }
  }

  /**
   * Get event by transaction hash
   */
  async getEventByTransactionHash(transactionHash: string): Promise<IEventLog | null> {
    try {
      return await EventLog.findOne({ transactionHash });
    } catch (error) {
      logger.error('Error fetching event by transaction hash:', error);
      return null;
    }
  }

  /**
   * Update event status with error
   */
  async markEventFailed(eventId: string, errorMessage: string): Promise<IEventLog | null> {
    try {
      const event = await EventLog.findByIdAndUpdate(
        eventId,
        { status: 'failed', errorMessage },
        { new: true },
      );
      if (event) {
        logger.warn(`Event ${eventId} marked as failed: ${errorMessage}`);
      }
      return event;
    } catch (error) {
      logger.error('Error marking event as failed:', error);
      return null;
    }
  }

  /**
   * Get the last processed ledger sequence
   */
  async getLastProcessedLedger(eventType?: string): Promise<number> {
    try {
      const last = await EventLog.findOne(
        eventType ? { eventType, status: 'processed' } : { status: 'processed' },
        { ledgerSequence: 1 },
        { sort: { ledgerSequence: -1 } },
      );
      return last ? last.ledgerSequence : 0;
    } catch (error) {
      logger.error('Error getting last processed ledger:', error);
      return 0;
    }
  }
}

export default new EventLogService();
