import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import EventLog from '../src/models/EventLog';
import EventArchiveManifest from '../src/models/EventArchiveManifest';
import {
  buildArchiveObjectKey,
  computeArchiveChecksum,
  EventArchiveService,
  LocalArchiveStorageBackend,
} from '../src/services/eventArchiveService';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Event cold-storage archiving beyond EventLog retention (#344)', () => {
  let mongoServer: MongoMemoryServer;
  let archiveRootDir: string;
  let service: EventArchiveService;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Promise.all([EventLog.init(), EventArchiveManifest.init()]);
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([EventLog.deleteMany({}), EventArchiveManifest.deleteMany({})]);
    archiveRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swiftchain-event-archives-'));
    service = new EventArchiveService({
      storage: new LocalArchiveStorageBackend(archiveRootDir),
      retentionDays: 90,
      batchSize: 100,
      keyPrefix: 'event-archives',
    });
  });

  afterEach(async () => {
    await fs.rm(archiveRootDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  }, 30_000);

  const daysAgo = (days: number, from = new Date('2026-11-24T12:00:00Z')): Date =>
    new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

  it('builds deterministic date/ledger object keys and SHA-256 checksums', () => {
    const key = buildArchiveObjectKey('event-archives', '2026-11-24', 1000, 1050, 'batch-1');
    expect(key).toBe('event-archives/2026/11/24/ledgers-1000-1050-batch-1.json');

    const digest = computeArchiveChecksum(Buffer.from('{"ok":true}', 'utf8'));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('archives processed events older than retention, records manifest, and leaves recent/unprocessed events in EventLog', async () => {
    const now = new Date('2026-11-24T12:00:00Z');

    await EventLog.create([
      {
        eventType: 'escrow',
        transactionHash: 'tx-old-1',
        ledgerSequence: 100,
        contractId: 'CESCROW1',
        eventData: { deliveryId: 'DEL-1', amount: 100 },
        status: 'processed',
        processedAt: daysAgo(120, now),
      },
      {
        eventType: 'delivery',
        transactionHash: 'tx-old-2',
        ledgerSequence: 150,
        contractId: 'CDELIVERY1',
        eventData: { deliveryId: 'DEL-1', status: 'delivered' },
        status: 'processed',
        processedAt: daysAgo(95, now),
      },
      {
        eventType: 'escrow',
        transactionHash: 'tx-old-failed',
        ledgerSequence: 120,
        contractId: 'CESCROW1',
        status: 'failed',
        errorMessage: 'retry pending',
      },
      {
        eventType: 'escrow',
        transactionHash: 'tx-recent-1',
        ledgerSequence: 500,
        contractId: 'CESCROW1',
        eventData: { deliveryId: 'DEL-2', amount: 50 },
        status: 'processed',
        processedAt: daysAgo(10, now),
      },
    ]);

    const result = await service.archiveExpiredEvents({ now });

    expect(result.archivedCount).toBe(2);
    expect(result.purgedCount).toBe(2);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest?.archiveKey).toMatch(
      /^event-archives\/2026\/11\/24\/ledgers-100-150-.+\.json$/,
    );
    expect(result.manifest?.startLedger).toBe(100);
    expect(result.manifest?.endLedger).toBe(150);
    expect(result.manifest?.eventCount).toBe(2);
    expect(result.manifest?.purgedFromEventLog).toBe(true);
    expect(result.manifest?.eventTypes).toEqual(expect.arrayContaining(['escrow', 'delivery']));

    // Hot EventLog retains only the failed event and recent processed event
    const remaining = await EventLog.find({}).sort({ ledgerSequence: 1 }).lean();
    expect(remaining.map((e) => e.transactionHash)).toEqual(['tx-old-failed', 'tx-recent-1']);

    // Manifest integrity check passes
    const verification = await service.verifyManifest(String(result.manifest?._id));
    expect(verification.valid).toBe(true);
    expect(verification.actualChecksum).toBe(verification.expectedChecksum);
    expect(verification.actualEventCount).toBe(2);
  });

  it('detects tampered archive files during manifest verification and retrieval', async () => {
    const now = new Date('2026-11-24T12:00:00Z');
    await EventLog.create({
      eventType: 'dispute',
      transactionHash: 'tx-disp-1',
      ledgerSequence: 300,
      contractId: 'CDISPUTE1',
      eventData: { disputeId: 'DISP-1' },
      status: 'processed',
      processedAt: daysAgo(100, now),
    });

    const { manifest } = await service.archiveExpiredEvents({ now });
    expect(manifest).not.toBeNull();

    // Tamper with the stored archive file on disk
    const filePath = path.join(archiveRootDir, manifest!.archiveKey);
    await fs.writeFile(filePath, '{"tampered":true}', 'utf8');

    const verification = await service.verifyManifest(String(manifest!._id));
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('Checksum mismatch');

    await expect(service.getArchivedEvents({ startLedger: 250, endLedger: 350 })).rejects.toThrow(
      /integrity verification failed/i,
    );
  });

  it('retrieves archived events across ledger boundaries, entity filters, and hot fallback', async () => {
    const now = new Date('2026-11-24T12:00:00Z');

    // Batch 1: ledgers 100..200
    await EventLog.create([
      {
        eventType: 'escrow',
        transactionHash: 'tx-100',
        ledgerSequence: 100,
        contractId: 'C-A',
        eventData: { deliveryId: 'D-100' },
        status: 'processed',
        processedAt: daysAgo(130, now),
      },
      {
        eventType: 'reputation',
        transactionHash: 'tx-200',
        ledgerSequence: 200,
        contractId: 'C-B',
        eventData: { driverAddress: 'GDRIVER1', points: 10 },
        status: 'processed',
        processedAt: daysAgo(125, now),
      },
    ]);
    await service.archiveExpiredEvents({ now });

    // Batch 2: ledgers 250..300
    await EventLog.create([
      {
        eventType: 'escrow',
        transactionHash: 'tx-250',
        ledgerSequence: 250,
        contractId: 'C-A',
        eventData: { deliveryId: 'D-250' },
        status: 'processed',
        processedAt: daysAgo(110, now),
      },
      {
        eventType: 'escrow',
        transactionHash: 'tx-300',
        ledgerSequence: 300,
        contractId: 'C-A',
        eventData: { deliveryId: 'D-300' },
        status: 'processed',
        processedAt: daysAgo(105, now),
      },
    ]);
    await service.archiveExpiredEvents({ now });

    // Hot event at ledger 400 (still within retention)
    await EventLog.create({
      eventType: 'escrow',
      transactionHash: 'tx-400',
      ledgerSequence: 400,
      contractId: 'C-A',
      eventData: { deliveryId: 'D-400' },
      status: 'processed',
      processedAt: daysAgo(5, now),
    });

    // Exact boundary query spanning two manifests
    const boundary = await service.getArchivedEvents({ startLedger: 200, endLedger: 250 });
    expect(boundary.map((e) => e.transactionHash)).toEqual(['tx-200', 'tx-250']);

    // Entity filter by eventType and contractId
    const escrowOnly = await service.getArchivedEvents({
      startLedger: 100,
      endLedger: 300,
      eventType: 'escrow',
      contractId: 'C-A',
    });
    expect(escrowOnly.map((e) => e.transactionHash)).toEqual(['tx-100', 'tx-250', 'tx-300']);

    // Transaction hash lookup in cold storage
    const byTx = await service.getArchivedEvents({ transactionHash: 'tx-200' });
    expect(byTx).toHaveLength(1);
    expect(byTx[0].eventType).toBe('reputation');

    // Combined cold + hot retrieval
    const combined = await service.getArchivedEvents({
      startLedger: 250,
      endLedger: 450,
      includeHot: true,
    });
    expect(combined.map((e) => e.transactionHash)).toEqual(['tx-250', 'tx-300', 'tx-400']);

    // Out-of-range query returns empty
    const empty = await service.getArchivedEvents({ startLedger: 500, endLedger: 600 });
    expect(empty).toEqual([]);
  });
});
