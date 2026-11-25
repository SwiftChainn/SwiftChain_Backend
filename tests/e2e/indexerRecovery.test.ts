/**
 * Indexer restart recovery E2E tests (#339).
 *
 * Verifies exact resume semantics across crashes mid-batch, crashes after
 * checkpoint advance, cold starts from persisted IndexerStatus, and
 * IndexerAlert / lag monitor reporting after recovery.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import EventLog from '../../src/models/EventLog';
import { IndexerStatus } from '../../src/models/IndexerStatus';
import { IndexerAlert } from '../../src/models/IndexerAlert';
import { EventPoller } from '../../src/services/eventPoller';
import { checkIndexerLag } from '../../src/services/monitorService';
import { sorobanService } from '../../src/blockchain/soroban.service';
import { stellarConfig } from '../../src/config/stellar';
import type {
  ISorobanRpcClient,
  SorobanGetEventsRequest,
} from '../../src/services/providers/sorobanRpcClient';

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const NETWORK = stellarConfig.network;
const CONTRACT_ID = 'CRECOVERYTESTCONTRACT123';
const TOPIC = 'escrow_funded';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([EventLog.init(), IndexerStatus.init(), IndexerAlert.init()]);
}, 120_000);

afterEach(async () => {
  await Promise.all([
    EventLog.deleteMany({}),
    IndexerStatus.deleteMany({}),
    IndexerAlert.deleteMany({}),
  ]);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

const makeEvent = (ledger: number, txHash: string): StellarRpc.Api.EventResponse =>
  ({
    id: `ev-${ledger}-${txHash}`,
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-11-25T00:00:00Z',
    contractId: CONTRACT_ID,
    txHash,
    topic: [xdr.ScVal.scvSymbol(TOPIC)],
    value: xdr.ScVal.scvVoid(),
    inSuccessfulContractCall: true,
    pagingToken: `ev-${ledger}`,
  }) as unknown as StellarRpc.Api.EventResponse;

const createPagedRpc = (
  latestLedger: number,
  events: StellarRpc.Api.EventResponse[],
  failOnPage?: number,
): { rpc: ISorobanRpcClient; getEvents: jest.Mock } => {
  let pageCall = 0;
  const getEvents = jest.fn(async (req: SorobanGetEventsRequest) => {
    pageCall += 1;
    if (failOnPage && pageCall === failOnPage) {
      throw new Error('simulated mid-batch crash');
    }
    const limit = req.limit ?? 100;
    const start =
      req.cursor !== undefined
        ? Number(req.cursor)
        : Math.max(
            0,
            events.findIndex((ev) => ev.ledger >= (req.startLedger ?? 0)),
          );
    const page = events.slice(start, start + limit);
    return { latestLedger, events: page, cursor: String(start + page.length) };
  });

  const rpc = {
    getLatestLedger: jest.fn(async () => ({ sequence: latestLedger })),
    getEvents,
  } as unknown as ISorobanRpcClient;

  return { rpc, getEvents };
};

const createPoller = (
  rpc: ISorobanRpcClient,
  handle: (event: StellarRpc.Api.EventResponse) => Promise<unknown>,
  pageSize = 100,
): EventPoller =>
  new EventPoller({
    rpc,
    network: NETWORK,
    contractId: CONTRACT_ID,
    subscriptions: [{ eventType: 'escrow', topic: TOPIC, handle }],
    intervalMs: 60_000,
    pageSize,
  });

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Indexer Restart Recovery (#339)', () => {
  it('recovers from a crash mid-batch (between EventLog write and checkpoint advance) without duplicates', async () => {
    await IndexerStatus.create({
      network: NETWORK,
      lastProcessedLedger: 100,
      lastProcessedAt: new Date(),
    });

    const batch = [makeEvent(101, 'tx-101'), makeEvent(102, 'tx-102'), makeEvent(103, 'tx-103')];

    // Crash on page 2 (pageSize=2 => page 1 processes tx-101 & tx-102, then crashes before checkpoint update)
    const applied: string[] = [];
    const handle = jest.fn(async (ev: StellarRpc.Api.EventResponse) => {
      applied.push(ev.txHash);
    });

    const crashing = createPagedRpc(105, batch, 2);
    await expect(createPoller(crashing.rpc, handle, 2).pollOnce()).rejects.toThrow(
      'simulated mid-batch crash',
    );

    // Checkpoint must NOT have advanced past 100
    const statusAfterCrash = await IndexerStatus.findOne({ network: NETWORK }).lean();
    expect(statusAfterCrash?.lastProcessedLedger).toBe(100);
    expect(applied).toEqual(['tx-101', 'tx-102']);

    // Also simulate a pending EventLog left behind by an abrupt kill before handler completed
    await EventLog.create({
      eventType: 'escrow',
      transactionHash: 'tx-103',
      ledgerSequence: 103,
      contractId: CONTRACT_ID,
      status: 'pending',
    });

    // Restart with a brand-new EventPoller instance
    const healthy = createPagedRpc(105, batch);
    const recoveryResult = await createPoller(healthy.rpc, handle, 2).pollOnce();

    // Resumed from 101, skipped already-processed tx-101 & tx-102, processed pending tx-103 once
    expect(recoveryResult).toMatchObject({
      fromLedger: 101,
      toLedger: 105,
      processed: 1,
      duplicates: 2,
      failed: 0,
    });
    expect(applied).toEqual(['tx-101', 'tx-102', 'tx-103']);
    expect(await EventLog.countDocuments({})).toBe(3);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      105,
    );
  });

  it('does not re-process events when restarted after a completed checkpoint', async () => {
    await IndexerStatus.create({
      network: NETWORK,
      lastProcessedLedger: 200,
      lastProcessedAt: new Date(),
    });

    const events = [makeEvent(201, 'tx-201'), makeEvent(202, 'tx-202')];
    const handle = jest.fn().mockResolvedValue(undefined);
    const { rpc, getEvents } = createPagedRpc(205, events);

    const first = await createPoller(rpc, handle).pollOnce();
    expect(first.processed).toBe(2);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      205,
    );

    // Simulate process restart at the same network head
    getEvents.mockClear();
    const restarted = createPoller(rpc, handle);
    const second = await restarted.pollOnce();

    expect(second).toMatchObject({ fromLedger: 206, toLedger: 205, fetched: 0, processed: 0 });
    expect(getEvents).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('cold-starts from persisted IndexerStatus and resumes at lastProcessedLedger + 1', async () => {
    await IndexerStatus.create({
      network: NETWORK,
      lastProcessedLedger: 500,
      lastProcessedAt: new Date(),
    });

    const events = [makeEvent(501, 'tx-501'), makeEvent(504, 'tx-504')];
    const handle = jest.fn().mockResolvedValue(undefined);
    const { rpc, getEvents } = createPagedRpc(510, events);

    const result = await createPoller(rpc, handle).pollOnce();

    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 501 }));
    expect(result).toMatchObject({ fromLedger: 501, toLedger: 510, processed: 2 });
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      510,
    );
  });

  it('reports lag breach in IndexerAlert before recovery and clears lag after recovery', async () => {
    await IndexerStatus.create({
      network: NETWORK,
      lastProcessedLedger: 100,
      lastProcessedAt: new Date(),
    });

    const latestLedgerSpy = jest.spyOn(sorobanService, 'getLatestLedger').mockResolvedValue(1_000);

    // Before recovery: lag is 900 ledgers -> breaches threshold & persists IndexerAlert
    const beforeRecovery = await checkIndexerLag();
    expect(beforeRecovery.breached).toBe(true);
    expect(beforeRecovery.lagLedgers).toBe(900);
    expect(await IndexerAlert.countDocuments({ network: NETWORK })).toBe(1);

    // Recover by polling up to ledger 1000
    const { rpc } = createPagedRpc(1_000, [makeEvent(999, 'tx-999')]);
    await createPoller(rpc, jest.fn().mockResolvedValue(undefined)).pollOnce();

    // After recovery: lag is 0 -> no breach and no additional alert persisted
    const afterRecovery = await checkIndexerLag();
    expect(afterRecovery.breached).toBe(false);
    expect(afterRecovery.lagLedgers).toBe(0);
    expect(afterRecovery.processedLedger).toBe(1_000);
    expect(await IndexerAlert.countDocuments({ network: NETWORK })).toBe(1);

    latestLedgerSpy.mockRestore();
  });
});
