import { Types } from 'mongoose';
import EventLog, { IEventLog } from '../models/EventLog';
import EventArchiveManifest, { IEventArchiveManifest } from '../models/EventArchiveManifest';

export interface CreateArchiveManifestInput {
  archiveKey: string;
  storageDriver: 'local' | 's3';
  archiveDate: string;
  startLedger: number;
  endLedger: number;
  eventCount: number;
  checksum: string;
  eventTypes: string[];
  contractIds: string[];
  archivedAt: Date;
  purgedFromEventLog: boolean;
}

export interface ManifestOverlapFilter {
  startLedger?: number;
  endLedger?: number;
  eventType?: string;
  contractId?: string;
}

export class EventArchiveRepository {
  /** Find processed EventLog entries older than `cutoffDate`, ordered by ledger sequence. */
  public async findArchivableEvents(cutoffDate: Date, limit: number): Promise<IEventLog[]> {
    return EventLog.find({
      status: 'processed',
      $or: [
        { processedAt: { $ne: null, $lte: cutoffDate } },
        { processedAt: null, createdAt: { $lte: cutoffDate } },
      ],
    })
      .sort({ ledgerSequence: 1, createdAt: 1 })
      .limit(limit);
  }

  /** Delete EventLog entries by their MongoDB ObjectIds once durably archived. */
  public async deleteEventLogsByIds(ids: Types.ObjectId[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await EventLog.deleteMany({ _id: { $in: ids } });
    return result.deletedCount ?? 0;
  }

  /** Persist a new archive manifest record. */
  public async createManifest(input: CreateArchiveManifestInput): Promise<IEventArchiveManifest> {
    return EventArchiveManifest.create(input);
  }

  /** Mark a manifest as having purged its archived entries from EventLog. */
  public async markManifestPurged(
    manifestId: Types.ObjectId | string,
  ): Promise<IEventArchiveManifest | null> {
    return EventArchiveManifest.findByIdAndUpdate(
      manifestId,
      { $set: { purgedFromEventLog: true } },
      { new: true },
    );
  }

  /** Find a manifest by its MongoDB id. */
  public async findManifestById(id: string): Promise<IEventArchiveManifest | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return EventArchiveManifest.findById(id);
  }

  /** List archive manifests paginated, newest first. */
  public async listManifests(
    page = 1,
    limit = 20,
  ): Promise<{ data: IEventArchiveManifest[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), 100);
    const [data, total] = await Promise.all([
      EventArchiveManifest.find({})
        .sort({ startLedger: -1, archivedAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      EventArchiveManifest.countDocuments({}),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }

  /** Find archive manifests whose ledger range overlaps `[startLedger, endLedger]`. */
  public async findManifestsForQuery(
    filter: ManifestOverlapFilter,
  ): Promise<IEventArchiveManifest[]> {
    const query: Record<string, unknown> = {};

    if (filter.startLedger !== undefined && filter.endLedger !== undefined) {
      query.startLedger = { $lte: filter.endLedger };
      query.endLedger = { $gte: filter.startLedger };
    } else if (filter.startLedger !== undefined) {
      query.endLedger = { $gte: filter.startLedger };
    } else if (filter.endLedger !== undefined) {
      query.startLedger = { $lte: filter.endLedger };
    }

    if (filter.eventType) {
      query.eventTypes = filter.eventType;
    }

    if (filter.contractId) {
      query.contractIds = filter.contractId;
    }

    return EventArchiveManifest.find(query).sort({ startLedger: 1, archivedAt: 1 });
  }

  /** Query hot EventLog records matching the same range/entity filter. */
  public async findHotEvents(filter: {
    startLedger?: number;
    endLedger?: number;
    eventType?: string;
    contractId?: string;
    transactionHash?: string;
  }): Promise<IEventLog[]> {
    const query: Record<string, unknown> = {};

    if (filter.startLedger !== undefined || filter.endLedger !== undefined) {
      const range: Record<string, number> = {};
      if (filter.startLedger !== undefined) range.$gte = filter.startLedger;
      if (filter.endLedger !== undefined) range.$lte = filter.endLedger;
      query.ledgerSequence = range;
    }
    if (filter.eventType) query.eventType = filter.eventType;
    if (filter.contractId) query.contractId = filter.contractId;
    if (filter.transactionHash) query.transactionHash = filter.transactionHash;

    return EventLog.find(query).sort({ ledgerSequence: 1, createdAt: 1 });
  }
}

export const eventArchiveRepository = new EventArchiveRepository();
