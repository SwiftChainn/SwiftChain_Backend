import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IEventLog extends Document {
  eventType: string;
  transactionHash: string;
  ledgerSequence: number;
  contractId?: string;
  /** Content-addressed SHA-256 hash over (contractId, topic, payload) + ledgerContext (#336). */
  eventHash?: string | null;
  eventData?: Record<string, unknown>;
  processedAt: Date | null;
  status: 'pending' | 'processed' | 'failed';
  errorMessage?: string | null;
  /** Retry attempts made after the initial failure (manual and scheduled). */
  retries: number;
  /** Error from the most recent failed attempt, initial or retry. */
  lastError?: string | null;
  /** When the retry job may next pick this entry up; null when none is scheduled. */
  nextRetryAt?: Date | null;
  /** Set once retries are exhausted and the entry is escalated to the DLQ. */
  deadLetteredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Define static methods interface
interface IEventLogModel extends Model<IEventLog> {
  markAsProcessed(transactionHash: string, eventType: string): Promise<IEventLog | null>;
  getLastProcessedLedger(eventType?: string): Promise<number>;
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
    status: {
      type: String,
      required: [true, 'Status is required'],
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: null,
    },
    retries: {
      type: Number,
      default: 0,
      min: [0, 'Retries cannot be negative'],
    },
    lastError: {
      type: String,
      trim: true,
      default: null,
    },
    nextRetryAt: {
      type: Date,
      default: null,
    },
    deadLetteredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
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

// Pre-save middleware to set processedAt if status is processed
EventLogSchema.pre<IEventLog>('save', function (next) {
  if (this.status === 'processed' && !this.processedAt) {
    this.processedAt = new Date();
  }
  next();
});

// Static method to mark events as processed
EventLogSchema.static(
  'markAsProcessed',
  async function (
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

// Static method to get the last processed ledger sequence
EventLogSchema.static(
  'getLastProcessedLedger',
  async function (this: IEventLogModel, eventType?: string): Promise<number> {
    const query = eventType ? { eventType, status: 'processed' } : { status: 'processed' };
    const lastEvent = await this.findOne(query).sort({ ledgerSequence: -1 }).limit(1);
    return lastEvent?.ledgerSequence || 0;
  },
);

// Static method to check if an event already exists
EventLogSchema.static(
  'eventExists',
  async function (
    this: IEventLogModel,
    transactionHash: string,
    eventType: string,
  ): Promise<boolean> {
    const event = await this.findOne({ transactionHash, eventType });
    return !!event;
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

export default EventLog;
