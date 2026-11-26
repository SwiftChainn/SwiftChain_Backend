import mongoose, { Schema, Document, Model } from 'mongoose';

export type ArchiveStorageDriverType = 'local' | 's3';

export interface IEventArchiveManifest extends Document {
  /** Deterministic object key in cold storage (e.g. event-archives/YYYY/MM/DD/ledgers-...json). */
  archiveKey: string;
  /** Storage driver holding the archive blob. */
  storageDriver: ArchiveStorageDriverType;
  /** UTC calendar date (YYYY-MM-DD) used in the archive key partition. */
  archiveDate: string;
  /** Lowest ledger sequence contained in this archive file (inclusive). */
  startLedger: number;
  /** Highest ledger sequence contained in this archive file (inclusive). */
  endLedger: number;
  /** Number of raw decoded events stored in this archive file. */
  eventCount: number;
  /** SHA-256 hex digest of the serialized archive JSON payload for integrity verification. */
  checksum: string;
  /** Distinct event families included in this archive batch. */
  eventTypes: string[];
  /** Distinct contract IDs included in this archive batch. */
  contractIds: string[];
  /** Timestamp when the archive was written. */
  archivedAt: Date;
  /** True once the archived entries have been purged from the hot EventLog collection. */
  purgedFromEventLog: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EventArchiveManifestSchema = new Schema<IEventArchiveManifest>(
  {
    archiveKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    storageDriver: {
      type: String,
      required: true,
      enum: ['local', 's3'],
    },
    archiveDate: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    startLedger: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },
    endLedger: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },
    eventCount: {
      type: Number,
      required: true,
      min: 1,
    },
    checksum: {
      type: String,
      required: true,
      trim: true,
    },
    eventTypes: {
      type: [String],
      default: [],
    },
    contractIds: {
      type: [String],
      default: [],
    },
    archivedAt: {
      type: Date,
      required: true,
      default: (): Date => new Date(),
    },
    purgedFromEventLog: {
      type: Boolean,
      required: true,
      default: false,
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

// Supports fast range-overlap queries when reading historical ledgers from cold storage.
EventArchiveManifestSchema.index({ startLedger: 1, endLedger: 1 });

export const EventArchiveManifest: Model<IEventArchiveManifest> =
  mongoose.model<IEventArchiveManifest>('EventArchiveManifest', EventArchiveManifestSchema);

export default EventArchiveManifest;
