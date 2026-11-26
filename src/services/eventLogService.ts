import EventLog, { IEventLog, RecordBatchInput, RecordBatchResult } from '../models/EventLog';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';
import type { ClientSession, SortOrder } from 'mongoose';

export async function recordBatchWithCheckpoint(
  events: RecordBatchInput,
  checkpointLedger: number,
): Promise<RecordBatchResult> {
  const mongooseDocEvents = events.map((event) =>
    event instanceof EventLog ? event : new EventLog(event as IEventLog),
  );
  let session: ClientSession | null = null;
  let sessionStarted = false;
  try {
    session = await startTrackedSession();
    sessionStarted = true;
    await EventLog.recordBatchWithCheckpoint(mongooseDocEvents, checkpointLedger);
    return { inserted: mongooseDocEvents.map((e) => e.toObject() as IEventLog), checkpointLedger };
  } catch (error) {
    if (sessionStarted && session) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

export async function recordProcessedLedger(ledger: number): Promise<void> {
  logger.info(`[EventLogService] recordProcessedLedger invoked for ledger ${ledger}`);
}

export class EventLogService {
  async createEventLog(eventData: {
    eventType: string;
    transactionHash: string;
    ledgerSequence: number;
    contractId?: string;
    eventData?: Record<string, unknown>;
    status?: string;
  }): Promise<IEventLog> {
    try {
      const existing = await EventLog.findOne({
        transactionHash: eventData.transactionHash,
        eventType: eventData.eventType,
      });
      if (existing) {
        throw new Error('Event already exists');
      }
      const event = new EventLog({
        eventType: eventData.eventType,
        transactionHash: eventData.transactionHash,
        ledgerSequence: eventData.ledgerSequence,
        contractId: eventData.contractId,
        eventData: eventData.eventData ?? {},
        status: eventData.status ?? 'pending',
        processedAt: null,
        errorMessage: null,
        retries: 0,
        lastError: null,
        nextRetryAt: null,
        deadLetteredAt: null,
      });
      await event.save();
      return event;
    } catch (error) {
      logger.error('Error creating event log:', error);
      throw error;
    }
  }

  async markAsProcessed(transactionHash: string, eventType?: string): Promise<IEventLog | null> {
    try {
      const filter: Record<string, unknown> = { transactionHash };
      if (eventType) {
        filter.eventType = eventType;
      }
      return await EventLog.findOneAndUpdate(
        filter,
        { status: 'processed', processedAt: new Date() },
        { new: true },
      );
    } catch (error) {
      logger.error('Error marking event as processed:', error);
      return null;
    }
  }

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

  async getEventByTransactionHash(transactionHash: string): Promise<IEventLog | null> {
    try {
      return await EventLog.findOne({ transactionHash });
    } catch (error) {
      logger.error('Error fetching event by transaction hash:', error);
      return null;
    }
  }

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
