import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import env from '../config/env';
import logger from '../config/logger';
import { IEventLog } from '../models/EventLog';
import { ArchiveStorageDriverType, IEventArchiveManifest } from '../models/EventArchiveManifest';
import {
  EventArchiveRepository,
  eventArchiveRepository,
} from '../repositories/EventArchiveRepository';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Canonical raw decoded event record preserved in cold storage with dedupe metadata. */
export interface ArchivedEventRecord {
  eventType: string;
  transactionHash: string;
  ledgerSequence: number;
  contractId: string | null;
  eventData: Record<string, unknown> | null;
  status: 'pending' | 'processed' | 'failed';
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventArchivePayload {
  schemaVersion: 1;
  archiveDate: string;
  startLedger: number;
  endLedger: number;
  eventCount: number;
  events: ArchivedEventRecord[];
}

export interface ArchiveStorageBackend {
  readonly driver: ArchiveStorageDriverType;
  write(key: string, content: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}

export interface ArchiveBatchResult {
  archivedCount: number;
  purgedCount: number;
  manifest: IEventArchiveManifest | null;
}

export interface ArchiveVerificationResult {
  manifestId: string;
  archiveKey: string;
  valid: boolean;
  expectedChecksum: string;
  actualChecksum: string | null;
  expectedEventCount: number;
  actualEventCount: number | null;
  reason?: string;
}

export interface ArchivedEventQuery {
  startLedger?: number;
  endLedger?: number;
  eventType?: string;
  contractId?: string;
  transactionHash?: string;
  includeHot?: boolean;
}

// ─── Storage backends ──────────────────────────────────────────────────────────

export class LocalArchiveStorageBackend implements ArchiveStorageBackend {
  public readonly driver: ArchiveStorageDriverType = 'local';
  private readonly baseDir: string;

  constructor(baseDir: string = env.EVENT_ARCHIVE_LOCAL_DIR) {
    this.baseDir = baseDir;
  }

  public async write(key: string, content: Buffer): Promise<void> {
    const filePath = this.resolveWithinRoot(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  public async read(key: string): Promise<Buffer> {
    const filePath = this.resolveWithinRoot(key);
    return fs.readFile(filePath);
  }

  private resolveWithinRoot(key: string): string {
    const root = path.resolve(process.cwd(), this.baseDir);
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error(`Refusing archive access outside root directory: ${key}`);
    }
    return resolved;
  }
}

export class S3ArchiveStorageBackend implements ArchiveStorageBackend {
  public readonly driver: ArchiveStorageDriverType = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(bucket: string = env.AWS_S3_BUCKET ?? '', client?: S3Client) {
    if (!bucket) {
      throw new Error('AWS_S3_BUCKET is required when EVENT_ARCHIVE_STORAGE_DRIVER=s3');
    }
    this.bucket = bucket;
    this.client =
      client ??
      new S3Client({
        region: env.AWS_REGION,
        credentials:
          env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.AWS_ACCESS_KEY_ID,
                secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
  }

  public async write(key: string, content: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'application/json',
      }),
    );
  }

  public async read(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!response.Body) {
      throw new Error(`Empty S3 body for archive key ${key}`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function computeArchiveChecksum(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function buildArchiveObjectKey(
  prefix: string,
  archiveDate: string,
  startLedger: number,
  endLedger: number,
  batchId: string = crypto.randomUUID(),
): string {
  const [year, month, day] = archiveDate.split('-');
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  return `${cleanPrefix}/${year}/${month}/${day}/ledgers-${startLedger}-${endLedger}-${batchId}.json`;
}

function serializeEventLog(doc: IEventLog): ArchivedEventRecord {
  return {
    eventType: doc.eventType,
    transactionHash: doc.transactionHash,
    ledgerSequence: doc.ledgerSequence,
    contractId: doc.contractId ?? null,
    eventData: doc.eventData ?? null,
    status: doc.status,
    processedAt: doc.processedAt ? new Date(doc.processedAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
  };
}

function matchesArchiveQuery(record: ArchivedEventRecord, query: ArchivedEventQuery): boolean {
  if (query.startLedger !== undefined && record.ledgerSequence < query.startLedger) {
    return false;
  }
  if (query.endLedger !== undefined && record.ledgerSequence > query.endLedger) {
    return false;
  }
  if (query.eventType && record.eventType !== query.eventType) {
    return false;
  }
  if (query.contractId && record.contractId !== query.contractId) {
    return false;
  }
  if (query.transactionHash && record.transactionHash !== query.transactionHash) {
    return false;
  }
  return true;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export interface EventArchiveServiceOptions {
  repository?: EventArchiveRepository;
  storage?: ArchiveStorageBackend;
  retentionDays?: number;
  batchSize?: number;
  keyPrefix?: string;
}

export class EventArchiveService {
  private readonly repository: EventArchiveRepository;
  private readonly storage: ArchiveStorageBackend;
  private readonly retentionDays: number;
  private readonly batchSize: number;
  private readonly keyPrefix: string;

  constructor(options: EventArchiveServiceOptions = {}) {
    this.repository = options.repository ?? eventArchiveRepository;
    this.storage =
      options.storage ??
      (env.EVENT_ARCHIVE_STORAGE_DRIVER === 's3'
        ? new S3ArchiveStorageBackend()
        : new LocalArchiveStorageBackend());
    this.retentionDays = options.retentionDays ?? env.EVENTLOG_RETENTION_DAYS;
    this.batchSize = options.batchSize ?? env.EVENT_ARCHIVE_BATCH_SIZE;
    this.keyPrefix = options.keyPrefix ?? env.EVENT_ARCHIVE_S3_PREFIX;
  }

  /**
   * Archive processed EventLog entries older than the retention window into cold
   * storage, record a verifiable manifest, and purge the archived entries from
   * EventLog so hot storage stays bounded.
   */
  public async archiveExpiredEvents(
    options: { now?: Date; retentionDays?: number; batchSize?: number; purge?: boolean } = {},
  ): Promise<ArchiveBatchResult> {
    const now = options.now ?? new Date();
    const retentionDays = options.retentionDays ?? this.retentionDays;
    const batchSize = options.batchSize ?? this.batchSize;
    const purge = options.purge ?? true;

    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const candidates = await this.repository.findArchivableEvents(cutoffDate, batchSize);

    if (candidates.length === 0) {
      return { archivedCount: 0, purgedCount: 0, manifest: null };
    }

    const events = candidates.map(serializeEventLog);
    const startLedger = events[0].ledgerSequence;
    const endLedger = events[events.length - 1].ledgerSequence;
    const archiveDate = now.toISOString().slice(0, 10);
    const archiveKey = buildArchiveObjectKey(this.keyPrefix, archiveDate, startLedger, endLedger);

    const payload: EventArchivePayload = {
      schemaVersion: 1,
      archiveDate,
      startLedger,
      endLedger,
      eventCount: events.length,
      events,
    };

    const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const checksum = computeArchiveChecksum(buffer);

    await this.storage.write(archiveKey, buffer);

    const eventTypes = Array.from(new Set(events.map((e) => e.eventType)));
    const contractIds = Array.from(
      new Set(events.map((e) => e.contractId).filter((id): id is string => Boolean(id))),
    );

    const manifest = await this.repository.createManifest({
      archiveKey,
      storageDriver: this.storage.driver,
      archiveDate,
      startLedger,
      endLedger,
      eventCount: events.length,
      checksum,
      eventTypes,
      contractIds,
      archivedAt: now,
      purgedFromEventLog: false,
    });

    let purgedCount = 0;
    if (purge) {
      const ids = candidates.map((doc) => doc._id as Types.ObjectId);
      purgedCount = await this.repository.deleteEventLogsByIds(ids);
      const updatedManifest = await this.repository.markManifestPurged(
        manifest._id as Types.ObjectId,
      );
      if (updatedManifest) {
        logger.info(
          `[EventArchiveService] Archived and purged ${events.length} events — ` +
            `key=${archiveKey} ledgers=${startLedger}-${endLedger} checksum=${checksum}`,
        );
        return { archivedCount: events.length, purgedCount, manifest: updatedManifest };
      }
    }

    logger.info(
      `[EventArchiveService] Archived ${events.length} events — ` +
        `key=${archiveKey} ledgers=${startLedger}-${endLedger} checksum=${checksum}`,
    );

    return { archivedCount: events.length, purgedCount, manifest };
  }

  /** Verify an archive object's SHA-256 checksum, event count, and ledger range against its manifest. */
  public async verifyManifest(manifestId: string): Promise<ArchiveVerificationResult> {
    const manifest = await this.repository.findManifestById(manifestId);
    if (!manifest) {
      throw new Error(`Archive manifest not found: ${manifestId}`);
    }

    let raw: Buffer;
    try {
      raw = await this.storage.read(manifest.archiveKey);
    } catch (error) {
      return {
        manifestId: String(manifest._id),
        archiveKey: manifest.archiveKey,
        valid: false,
        expectedChecksum: manifest.checksum,
        actualChecksum: null,
        expectedEventCount: manifest.eventCount,
        actualEventCount: null,
        reason: `Unable to read archive object: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const actualChecksum = computeArchiveChecksum(raw);
    if (actualChecksum !== manifest.checksum) {
      return {
        manifestId: String(manifest._id),
        archiveKey: manifest.archiveKey,
        valid: false,
        expectedChecksum: manifest.checksum,
        actualChecksum,
        expectedEventCount: manifest.eventCount,
        actualEventCount: null,
        reason: 'Checksum mismatch: archive object may have been tampered with or corrupted',
      };
    }

    let parsed: EventArchivePayload;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as EventArchivePayload;
    } catch (error) {
      return {
        manifestId: String(manifest._id),
        archiveKey: manifest.archiveKey,
        valid: false,
        expectedChecksum: manifest.checksum,
        actualChecksum,
        expectedEventCount: manifest.eventCount,
        actualEventCount: null,
        reason: `Invalid archive JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const actualEventCount = Array.isArray(parsed.events) ? parsed.events.length : -1;
    if (actualEventCount !== manifest.eventCount) {
      return {
        manifestId: String(manifest._id),
        archiveKey: manifest.archiveKey,
        valid: false,
        expectedChecksum: manifest.checksum,
        actualChecksum,
        expectedEventCount: manifest.eventCount,
        actualEventCount,
        reason: `Event count mismatch: expected ${manifest.eventCount}, got ${actualEventCount}`,
      };
    }

    return {
      manifestId: String(manifest._id),
      archiveKey: manifest.archiveKey,
      valid: true,
      expectedChecksum: manifest.checksum,
      actualChecksum,
      expectedEventCount: manifest.eventCount,
      actualEventCount,
    };
  }

  /** List persisted archive manifests (paginated). */
  public async listManifests(
    page = 1,
    limit = 20,
  ): Promise<{
    data: IEventArchiveManifest[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const result = await this.repository.listManifests(page, limit);
    return {
      ...result,
      totalPages: Math.ceil(result.total / result.limit),
    };
  }

  /**
   * Retrieve events from cold storage (and optionally merge with hot EventLog
   * entries) by ledger range and/or entity filters (`eventType`, `contractId`,
   * `transactionHash`), deduplicated on `(transactionHash, eventType)`.
   */
  public async getArchivedEvents(query: ArchivedEventQuery): Promise<ArchivedEventRecord[]> {
    const dedupe = new Map<string, ArchivedEventRecord>();

    if (query.includeHot) {
      const hotEvents = await this.repository.findHotEvents(query);
      for (const doc of hotEvents) {
        const record = serializeEventLog(doc);
        dedupe.set(`${record.transactionHash}:${record.eventType}`, record);
      }
    }

    const manifests = await this.repository.findManifestsForQuery({
      startLedger: query.startLedger,
      endLedger: query.endLedger,
      eventType: query.eventType,
      contractId: query.contractId,
    });

    for (const manifest of manifests) {
      const raw = await this.storage.read(manifest.archiveKey);
      const actualChecksum = computeArchiveChecksum(raw);
      if (actualChecksum !== manifest.checksum) {
        throw new Error(
          `Archive integrity verification failed for key=${manifest.archiveKey} ` +
            `(expected=${manifest.checksum}, actual=${actualChecksum})`,
        );
      }

      const parsed = JSON.parse(raw.toString('utf8')) as EventArchivePayload;
      for (const record of parsed.events) {
        if (!matchesArchiveQuery(record, query)) continue;
        const key = `${record.transactionHash}:${record.eventType}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, record);
        }
      }
    }

    return Array.from(dedupe.values()).sort((a, b) => a.ledgerSequence - b.ledgerSequence);
  }
}

export const eventArchiveService = new EventArchiveService();
