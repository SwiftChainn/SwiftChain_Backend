import mongoose, { Schema, Document } from 'mongoose';
import { startTrackedSession } from '../config/database';
import logger from '../config/logger';

export interface IEventLog extends Document {
  eventType: 'escrow' | 'delivery' | string;
  transactionHash: string;
  ledgerSequence: number;
  contractId?: string;
  /** Content-addressed SHA-256 hash over (contractId, topic, payload) + ledgerContext (#336). */
  eventHash?: string | null;
  eventData?: Record<string, unknown>;
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
  findByEventHash(eventHash: string): Promise<IEventLog | null>;
  recordOrReplay(data: Partial<IEventLog>): Promise<{ event: IEventLog; replayed: boolean }>;
}

const EventLogSchema = new Schema<IEventLog, IEventLogModel>(
  {
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      enum: ['delivery', 'escrow', 'dispute', 'reputation', 'milestone'],
      index: true,
    },
    transactionHash: {
      type: String,
      required: [true, 'Transaction hash is required'],
      index: true,
      trim: true,
    },
    ledgerSequence: {
      type: Number,
      required: [true, 'Ledger sequence is required'],
      index: true,
      min: [0, 'Ledger sequence must be a positive number'],
    },
    contractId: {
      type: String,
      index: true,
      trim: true,
      default: null,
    },
    eventHash: {
      type: String,
      trim: true,
      default: undefined,
    },
    eventData: {
      type: Schema.Types.Mixed,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
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

// Legacy compound index kept during the migration window (#336)
EventLogSchema.index({ transactionHash: 1, eventType: 1 }, { unique: true });

// Content-addressed unique event-hash index (sparse so legacy docs without eventHash coexist) (#336)
EventLogSchema.index({ eventHash: 1 }, { unique: true, sparse: true });

// Index for efficient querying of unprocessed events
EventLogSchema.index({ status: 1, createdAt: 1 });

// Index for the retry job: failed entries whose backoff window has elapsed
EventLogSchema.index({ status: 1, nextRetryAt: 1 });

// Index for ledger sequence range queries
EventLogSchema.index({ ledgerSequence: 1, eventType: 1 });

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

// Static method to look up an event by its content-addressed eventHash (#336)
EventLogSchema.static(
  'findByEventHash',
  async function (this: IEventLogModel, eventHash: string): Promise<IEventLog | null> {
    return this.findOne({ eventHash });
  },
);

// Idempotent insert: returns the existing record on duplicate eventHash or legacy key collision (#336)
EventLogSchema.static(
  'recordOrReplay',
  async function (
    this: IEventLogModel,
    data: Partial<IEventLog>,
  ): Promise<{ event: IEventLog; replayed: boolean }> {
    if (data.eventHash) {
      const existingByHash = await this.findOne({ eventHash: data.eventHash });
      if (existingByHash) {
        return { event: existingByHash, replayed: true };
      }
    }

    if (data.transactionHash && data.eventType) {
      const existingByLegacy = await this.findOne({
        transactionHash: data.transactionHash,
        eventType: data.eventType,
      });
      if (existingByLegacy) {
        return { event: existingByLegacy, replayed: true };
      }
    }

    try {
      const created = await this.create(data);
      return { event: created, replayed: false };
    } catch (error: unknown) {
      const isDuplicate =
        typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
      if (isDuplicate) {
        const existing =
          (data.eventHash ? await this.findOne({ eventHash: data.eventHash }) : null) ??
          (data.transactionHash && data.eventType
            ? await this.findOne({
                transactionHash: data.transactionHash,
                eventType: data.eventType,
              })
            : null);
        if (existing) {
          return { event: existing, replayed: true };
        }
      }
      throw error;
    }
  },
);

const EventLog = mongoose.model<IEventLog, IEventLogModel>('EventLog', EventLogSchema);

const EventLog = mongoose.model<IEventLog, IEventLogModel>('EventLog', EventLogSchema);
export default EventLog;
