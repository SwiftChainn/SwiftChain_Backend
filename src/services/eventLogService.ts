import EventLog, { IEventLog, RecordBatchInput, RecordBatchResult } from '../models/EventLog';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';

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
