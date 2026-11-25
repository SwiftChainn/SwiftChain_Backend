/**
 * Unit & integration tests for event-hash deduplication index (#336).
 *
 * Proves:
 * - Deterministic SHA-256 `eventHash` computation from (contractId, topic, payload) + ledgerContext.
 * - Unique `eventHash` index on EventLog coexisting with legacy {transactionHash, eventType}.
 * - Idempotent replay on collision (returns existing record rather than throwing).
 * - Duplicate delivery and simulated poller restart process an event exactly once.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { nativeToScVal, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import EventLog from '../src/models/EventLog';
import { IndexerStatus } from '../src/models/IndexerStatus';
import eventLogService from '../src/services/eventLogService';
import { EventPoller } from '../src/services/eventPoller';
import { computeEventHash, computeEventHashFromRpcEvent } from '../src/utils/eventHash';
import type {
  ISorobanRpcClient,
  SorobanGetEventsRequest,
} from '../src/services/providers/sorobanRpcClient';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const CONTRACT_ID = 'CDEDUPTESTCONTRACT000000000000000000000000000000000000001';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([EventLog.init(), IndexerStatus.init()]);
}, 120_000);

afterEach(async () => {
  await Promise.all([EventLog.deleteMany({}), IndexerStatus.deleteMany({})]);
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function buildRpcEvent(
  overrides?: Partial<{ id: string; ledger: number; txHash: string; deliveryId: string }>,
): StellarRpc.Api.EventResponse {
  const ledger = overrides?.ledger ?? 500;
  const id = overrides?.id ?? `0000500-0000000001`;
  const deliveryId = overrides?.deliveryId ?? 'DLV-HASH-1';
  return {
    id,
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-11-24T00:00:00Z',
    contractId: CONTRACT_ID,
    txHash: overrides?.txHash ?? 'tx-hash-dedup-001',
    topic: [xdr.ScVal.scvSymbol('escrow_funded'), nativeToScVal(deliveryId, { type: 'string' })],
    value: nativeToScVal({ amount: 1000, asset: 'XLM' }),
    inSuccessfulContractCall: true,
    pagingToken: id,
  } as unknown as StellarRpc.Api.EventResponse;
}

describe('Event-hash deduplication (#336)', () => {
  it('computes identical SHA-256 hashes regardless of payload key order', () => {
    const hashA = computeEventHash({
      contractId: CONTRACT_ID,
      topic: ['escrow_funded', 'DLV-1'],
      payload: { amount: 100n, asset: 'XLM', meta: { b: 2, a: 1 } },
      ledgerContext: { ledgerSequence: 42, transactionHash: 'tx-1', eventId: 'evt-1' },
    });

    const hashB = computeEventHash({
      contractId: CONTRACT_ID,
      topic: ['escrow_funded', 'DLV-1'],
      payload: { meta: { a: 1, b: 2 }, asset: 'XLM', amount: 100n },
      ledgerContext: { ledgerSequence: 42, transactionHash: 'tx-1', eventId: 'evt-1' },
    });

    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(hashA).toBe(hashB);

    // Changing any component changes the hash
    const diffLedger = computeEventHash({
      contractId: CONTRACT_ID,
      topic: ['escrow_funded', 'DLV-1'],
      payload: { amount: 100n, asset: 'XLM', meta: { b: 2, a: 1 } },
      ledgerContext: { ledgerSequence: 43, transactionHash: 'tx-1', eventId: 'evt-1' },
    });
    expect(diffLedger).not.toBe(hashA);
  });

  it('returns the existing record on eventHash collision (idempotent replay)', async () => {
    const event = buildRpcEvent();
    const eventHash = computeEventHashFromRpcEvent(event, CONTRACT_ID);

    const first = await eventLogService.recordEventIdempotent({
      eventType: 'escrow',
      transactionHash: event.txHash,
      ledgerSequence: event.ledger,
      contractId: CONTRACT_ID,
      eventHash,
      status: 'processed',
    });

    expect(first.replayed).toBe(false);
    expect(first.event.eventHash).toBe(eventHash);

    // Delivering the exact same eventHash again returns the existing record without erroring
    const second = await eventLogService.recordEventIdempotent({
      eventType: 'escrow',
      transactionHash: event.txHash,
      ledgerSequence: event.ledger,
      contractId: CONTRACT_ID,
      eventHash,
      status: 'pending',
    });

    expect(second.replayed).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    expect(await EventLog.countDocuments({ eventHash })).toBe(1);
    expect((await eventLogService.getEventByHash(eventHash))?.id).toBe(first.event.id);
  });

  it('processes the same event delivered twice and across a poller restart exactly once', async () => {
    const event = buildRpcEvent();
    const handle = jest.fn().mockResolvedValue(undefined);

    const createRpc = (): ISorobanRpcClient =>
      ({
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 500 }),
        getEvents: jest.fn().mockImplementation(async (req: SorobanGetEventsRequest) => ({
          latestLedger: 500,
          // Deliver the exact same event twice in the same page
          events: req.cursor ? [] : [event, event],
          cursor: 'done',
        })),
      }) as unknown as ISorobanRpcClient;

    // Cycle 1: duplicate delivery within a single poll cycle
    const poller1 = new EventPoller({
      rpc: createRpc(),
      network: 'testnet',
      contractId: CONTRACT_ID,
      subscriptions: [{ eventType: 'escrow', topic: 'escrow_funded', handle }],
      intervalMs: 60_000,
      pageSize: 100,
    });

    const firstCycle = await poller1.pollOnce();
    expect(firstCycle.fetched).toBe(2);
    expect(firstCycle.processed).toBe(1);
    expect(firstCycle.duplicates).toBe(1);
    expect(handle).toHaveBeenCalledTimes(1);

    // Simulated process restart: reset checkpoint to replay ledger 500 with a fresh EventPoller instance
    await IndexerStatus.updateOne({ network: 'testnet' }, { $set: { lastProcessedLedger: 499 } });

    const poller2 = new EventPoller({
      rpc: createRpc(),
      network: 'testnet',
      contractId: CONTRACT_ID,
      subscriptions: [{ eventType: 'escrow', topic: 'escrow_funded', handle }],
      intervalMs: 60_000,
      pageSize: 100,
    });

    const restartCycle = await poller2.pollOnce();
    expect(restartCycle.processed).toBe(0);
    expect(restartCycle.duplicates).toBe(2);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(await EventLog.countDocuments({})).toBe(1);
  });
});
