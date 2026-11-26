import mongoose, { Schema, Document } from 'mongoose';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';

export interface IEventLog extends Document {
  eventType: 'escrow' | 'delivery' | string;
  transactionHash: string;
  ledgerSequence: number;
  contractId?: string;
  eventData: Record<string, unknown>;
  indexedAt?: Date;
  processedAt: Date | null;
  status: 'pending' | 'processed' | 'failed';
  errorMessage?: string | null;
  retries: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  deadLetteredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RecordBatchInput = IEventLog[];
export type RecordBatchResult = {
  inserted: IEventLog[];
  checkpointLedger: number;
};

export interface IEventLogModel extends mongoose.Model<IEventLog> {
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
  ) => Promise<IEventLog>;
  eventExists(transactionHash: string, eventType: string): Promise<boolean>;
  markAsProcessed(transactionHash: string, eventType: string): Promise<IEventLog | null>;
}

const EventLogSchema = new Schema<IEventLog, IEventLogModel>(
  {
    eventType: {
      type: String,
      required: true,
      enum: ['escrow', 'delivery', 'dispute', 'reputation', 'milestone'],
    },
    transactionHash: { type: String, required: true, trim: true },
    ledgerSequence: { type: Number, required: true },
    contractId: { type: String, required: false },
    eventData: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
    indexedAt: { type: Date, required: false },
    processedAt: { type: Date, required: true, default: null },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
    },
    errorMessage: { type: String, required: false, default: null },
    retries: { type: Number, required: true, default: 0 },
    lastError: { type: String, required: false, default: null },
    nextRetryAt: { type: Date, required: false, default: null },
    deadLetteredAt: { type: Date, required: false, default: null },
  },
  { timestamps: true, versionKey: false },
);

EventLogSchema.index(
  { transactionHash: 1, eventType: 1 },
  { unique: true, name: 'idx_event_log_transaction_hash_event_type' },
);

EventLogSchema.pre<IEventLog>('save', function (next) {
  this.updatedAt = new Date();
  next();
});

EventLogSchema.static(
  'recordBatchWithCheckpoint',
  async function recordBatchWithCheckpoint(
    this: IEventLogModel,
    events: RecordBatchInput,
    checkpointLedger: number,
  ): Promise<RecordBatchResult> {
    const mongooseDocEvents = events.map((event) =>
      event instanceof mongoose.Document ? (event as IEventLog) : (event as IEventLog),
    );
    const session = await startTrackedSession();
    const inserted: IEventLog[] = [];
    try {
      for (const event of mongooseDocEvents) {
        const createdDocs = await this.create([event], { session });
        inserted.push(createdDocs[0].toObject() as IEventLog);
      }
      await this.db.collection('indexer_statuses').updateOne(
        { network: 'main' },
        {
          $set: { lastProcessedLedger: checkpointLedger, lastProcessedAt: new Date() },
          $setOnInsert: { network: 'main', createdAt: new Date(), updatedAt: new Date() },
        },
        { session, upsert: true },
      );
      logger.info(
        `[EventLog] Batch of ${inserted.length} events persisted and checkpoint advanced to ledger ${checkpointLedger}`,
      );
      return { inserted: inserted.map((e) => e.toObject() as IEventLog), checkpointLedger };
    } catch (error) {
      logger.error('[EventLog] Failed to record batch with checkpoint:', error);
      throw error;
    } finally {
      await session.endSession();
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
  ): Promise<IEventLog> {
    const created = await this.create(event as IEventLog);
    await this.db.collection('indexer_statuses').updateOne(
      { network: 'main' },
      {
        $set: { lastProcessedLedger: checkpointLedger, lastProcessedAt: new Date() },
        $setOnInsert: { network: 'main', createdAt: new Date(), updatedAt: new Date() },
      },
      { upsert: true },
    );
    return created;
  },
);

EventLogSchema.static(
  'eventExists',
  async function eventExists(
    this: IEventLogModel,
    transactionHash: string,
    eventType: string,
  ): Promise<boolean> {
    const count = await this.countDocuments({ transactionHash, eventType });
    return count > 0;
  },
);

EventLogSchema.static(
  'markAsProcessed',
  async function markAsProcessed(
    this: IEventLogModel,
    transactionHash: string,
    eventType: string,
  ): Promise<IEventLog | null> {
    return this.findOneAndUpdate(
      { transactionHash, eventType },
      { status: 'processed', processedAt: new Date() },
      { new: true },
    );
  },
);

const EventLog = mongoose.model<IEventLog, IEventLogModel>('EventLog', EventLogSchema);
export default EventLog;
