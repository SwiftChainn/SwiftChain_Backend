import mongoose from 'mongoose';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';

export interface IEventLog {
  eventType: 'escrow' | 'delivery' | string;
  transactionHash: string;
  ledgerSequence: number;
  contractId?: string;
  eventData: Record<string, unknown>;
  indexedAt?: Date;
}

export interface IEventLogDocument extends Omit<IEventLog, 'eventType'>, mongoose.Document {
  eventType: 'escrow' | 'delivery' | string;
}

export type RecordBatchInput = IEventLog[] | IEventLogDocument[];
export type RecordBatchResult = {
  inserted: IEventLog[];
  checkpointLedger: number;
};

export interface IEventLogModel extends mongoose.Model<IEventLogDocument> {
  recordBatchWithCheckpoint: (
    this: IEventLogModel,
    events: RecordBatchInput,
    checkpointLedger: number,
  ) => Promise<RecordBatchResult>;
  recordEventWithCheckpointFallback: (
    this: IEventLogModel,
    event: Pick<
      IEventLog,
      'eventType' | 'transactionHash' | 'ledgerSequence' | 'contractId' | 'eventData'
    >,
    checkpointLedger: number,
  ) => Promise<IEventLogDocument>;
}

const eventLogSchemaFields: SchemaDefinition<IEventLog> = {
  eventType: { type: String, required: true, enum: ['escrow', 'delivery', 'dispute'] },
  transactionHash: { type: String, required: true },
  ledgerSequence: { type: Number, required: true },
  contractId: { type: String, required: false },
  eventData: { type: Object as () => Record<string, unknown>, required: true, default: {} },
  indexedAt: { type: Date, required: false },
};

const EventLogSchema = new mongoose.Schema<IEventLogDocument, IEventLogModel>(
  eventLogSchemaFields,
  {
    timestamps: true,
    toJSON: {
      transform: (
        _doc: IEventLogDocument,
        ret: Record<string, unknown>,
      ): Record<string, unknown> => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

EventLogSchema.index(
  { transactionHash: 1, eventType: 1 },
  { unique: true, name: 'idx_event_log_transaction_hash_event_type' },
);

EventLogSchema.static(
  'recordBatchWithCheckpoint',
  async function recordBatchWithCheckpoint(
    this: IEventLogModel,
    events: RecordBatchInput,
    checkpointLedger: number,
  ): Promise<RecordBatchResult> {
    const mongooseDocEvents = events.map((event) =>
      event instanceof mongoose.Document ? (event as IEventLogDocument) : (event as IEventLog),
    );

    // Transaction-critical path: persist events document-by-document, then atomically
    // advance the checkpoint in the same Mongoose session so a crash cannot leave events
    // persisted without their checkpoint (exactly-once semantics).
    const session = await startTrackedSession();
    const inserted: IEventLog[] = [];
    try {
      for (const event of mongooseDocEvents) {
        const createdDoc = await this.create([event], { session });
        inserted.push(createdDoc.toObject() as IEventLog);
      }

      // Update the checkpoint after all events are persisted in this batch.
      await this.db.collection('indexer_statuses').updateOne(
        { network: 'main' },
        {
          $set: {
            lastProcessedLedger: checkpointLedger,
            lastProcessedAt: new Date(),
          },
          $setOnInsert: {
            network: 'main',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { session, upsert: true },
      );

      await session.commitTransaction();
      logger.info(
        `[EventLogService] Atomically recorded batch of ${inserted.length} events ` +
          `and advanced checkpoint to ledger ${checkpointLedger}`,
      );
      return { inserted, checkpointLedger };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  },
);

EventLogSchema.static(
  'recordEventWithCheckpointFallback',
  async function recordEventWithCheckpointFallback(
    this: IEventLogModel,
    event: Pick<
      IEventLog,
      'eventType' | 'transactionHash' | 'ledgerSequence' | 'contractId' | 'eventData'
    >,
    checkpointLedger: number,
  ): Promise<IEventLogDocument> {
    // Insert the event; the unique index rejects duplicates.
    const created = await this.create(event as IEventLog);

    // Upsert the checkpoint in the same operation order so a crash here cannot
    // leave an event without its checkpoint or a checkpoint without its event.
    await this.db.collection('indexer_statuses').updateOne(
      { network: 'main' },
      {
        $set: {
          lastProcessedLedger: checkpointLedger,
          lastProcessedAt: new Date(),
        },
        $setOnInsert: {
          network: 'main',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    return created;
  },
);

const EventLog = mongoose.model<IEventLog, IEventLogModel>('EventLog', EventLogSchema);

export default EventLog;
