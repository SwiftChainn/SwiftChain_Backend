import mongoose, { Schema, Document, Model } from 'mongoose';

export type CorrelatedEntityType = 'delivery' | 'escrow' | 'dispute' | 'reputation' | 'milestone';

export interface IEventCorrelation extends Document {
  contractId: string;
  transactionHash: string;
  ledgerSequence: number;
  eventType: CorrelatedEntityType;
  eventHash?: string | null;
  eventLogId?: mongoose.Types.ObjectId | null;
  topic?: string | null;
  entityType: CorrelatedEntityType;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const EventCorrelationSchema = new Schema<IEventCorrelation>(
  {
    contractId: {
      type: String,
      required: [true, 'Contract ID is required'],
      trim: true,
      index: true,
    },
    transactionHash: {
      type: String,
      required: [true, 'Transaction hash is required'],
      trim: true,
      index: true,
    },
    ledgerSequence: {
      type: Number,
      required: [true, 'Ledger sequence is required'],
      min: [0, 'Ledger sequence must be non-negative'],
      index: true,
    },
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      enum: ['delivery', 'escrow', 'dispute', 'reputation', 'milestone'],
      index: true,
    },
    eventHash: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    eventLogId: {
      type: Schema.Types.ObjectId,
      ref: 'EventLog',
      default: null,
    },
    topic: {
      type: String,
      trim: true,
      default: null,
    },
    entityType: {
      type: String,
      required: [true, 'Entity type is required'],
      enum: ['delivery', 'escrow', 'dispute', 'reputation', 'milestone'],
      index: true,
    },
    entityId: {
      type: String,
      required: [true, 'Entity ID is required'],
      trim: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
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

// Unique correlation index mapping on-chain coordinates to the mutated off-chain entity.
EventCorrelationSchema.index(
  {
    contractId: 1,
    transactionHash: 1,
    ledgerSequence: 1,
    eventType: 1,
    entityType: 1,
    entityId: 1,
  },
  { unique: true, name: 'idx_event_correlation_unique' },
);

// Fast reverse lookup: all on-chain events that touched an off-chain entity.
EventCorrelationSchema.index({ entityType: 1, entityId: 1, ledgerSequence: 1 });

// Fast ledger-range lookup for admin explorer / audits.
EventCorrelationSchema.index({ ledgerSequence: 1, eventType: 1 });

const EventCorrelation: Model<IEventCorrelation> = mongoose.model<IEventCorrelation>(
  'EventCorrelation',
  EventCorrelationSchema,
);

export default EventCorrelation;
