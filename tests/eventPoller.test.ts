/**
 * Integration tests for the event poller.
 *
 * EventLog and IndexerStatus are real models on an in-memory MongoDB, so the
 * unique {transactionHash, eventType} index and the checkpoint behaviour are
 * exercised for real. The Soroban RPC node is replaced with a fake that pages
 * through a fixed event list, which keeps the tests off the network.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import { performance } from 'node:perf_hooks';
import EventLog from '../src/models/EventLog';
import { IndexerStatus } from '../src/models/IndexerStatus';
import { EventPoller, EventSubscription, computeJitteredInterval } from '../src/services/eventPoller';
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

const NETWORK = 'testnet';
const CONTRACT_ID = 'CTESTESCROWCONTRACT';
const FUNDED_TOPIC = 'escrow_funded';
const RELEASED_TOPIC = 'escrow_released';

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

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** A contract event shaped like the SDK's parsed `getEvents` response. */
const buildEvent = (
  overrides: Partial<{ id: string; ledger: number; txHash: string; topic: string }> = {},
): StellarRpc.Api.EventResponse => {
  const ledger = overrides.ledger ?? 101;
  const id = overrides.id ?? `event-${ledger}`;
  return {
    id,
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-10-21T00:00:00Z',
    contractId: CONTRACT_ID,
    txHash: overrides.txHash ?? `tx-${id}`,
    topic: [xdr.ScVal.scvSymbol(overrides.topic ?? FUNDED_TOPIC)],
    value: xdr.ScVal.scvVoid(),
    inSuccessfulContractCall: true,
    pagingToken: id,
  } as unknown as StellarRpc.Api.EventResponse;
};

/**
 * Fake RPC node. `getEvents` returns events from the start ledger in pages of
 * `limit`, with an index-based cursor, mirroring how the real node pages.
 */
const createFakeRpc = (
  latestLedger: number,
  events: StellarRpc.Api.EventResponse[],
): {
  rpc: ISorobanRpcClient;
  getLatestLedger: jest.Mock;
  getEvents: jest.Mock;
} => {
  const getLatestLedger = jest.fn(async () => ({ sequence: latestLedger }));
  const getEvents = jest.fn(async (request: SorobanGetEventsRequest) => {
    const limit = request.limit ?? 100;
    const start =
      request.cursor !== undefined
        ? Number(request.cursor)
        : Math.max(
            0,
            events.findIndex((event) => event.ledger >= (request.startLedger ?? 0)),
          );
    const page = events.slice(start, start + limit);
    return {
      latestLedger,
      events: page,
      cursor: String(start + page.length),
    };
  });

  return {
    rpc: { getLatestLedger, getEvents } as unknown as ISorobanRpcClient,
    getLatestLedger,
    getEvents,
  };
};

const subscriptionFor = (
  handle: EventSubscription['handle'],
  topic = FUNDED_TOPIC,
): EventSubscription => ({ eventType: 'escrow', topic, handle });

const createPoller = (
  rpc: ISorobanRpcClient,
  handle: EventSubscription['handle'],
  pageSize = 100,
  jitterRatio?: number,
): EventPoller =>
  new EventPoller({
    rpc,
    network: NETWORK,
    contractId: CONTRACT_ID,
    subscriptions: [subscriptionFor(handle)],
    intervalMs: 60_000,
    jitterRatio,
    pageSize,
  });

const setCheckpoint = async (lastProcessedLedger: number): Promise<void> => {
  await IndexerStatus.updateOne(
    { network: NETWORK },
    { $set: { lastProcessedLedger, lastProcessedAt: new Date() } },
    { upsert: true },
  );
};

const readCheckpoint = async (): Promise<number | undefined> =>
  (await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger;

const flush = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('EventPoller', () => {
  describe('ingestion', () => {
    it('records each new event, dispatches it to the handler, and advances the checkpoint', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 101, txHash: 'tx-1' }),
        buildEvent({ ledger: 103, txHash: 'tx-2' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);

      const result = await createPoller(rpc, handle).pollOnce();

      expect(handle).toHaveBeenCalledTimes(2);
      expect(handle).toHaveBeenNthCalledWith(1, events[0]);
      expect(handle).toHaveBeenNthCalledWith(2, events[1]);

      const rows = await EventLog.find({}).sort({ ledgerSequence: 1 }).lean();
      expect(rows.map((row) => [row.transactionHash, row.status, row.ledgerSequence])).toEqual([
        ['tx-1', 'processed', 101],
        ['tx-2', 'processed', 103],
      ]);
      expect(rows[0].processedAt).toBeInstanceOf(Date);
      expect(rows[0].contractId).toBe(CONTRACT_ID);

      expect(result).toMatchObject({
        fromLedger: 101,
        toLedger: 105,
        fetched: 2,
        processed: 2,
        duplicates: 0,
        failed: 0,
      });
      expect(await readCheckpoint()).toBe(105);
    });

    it('ignores events for topics that have no subscription', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 101, txHash: 'tx-released', topic: RELEASED_TOPIC }),
        buildEvent({ ledger: 102, txHash: 'tx-funded' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);

      const result = await createPoller(rpc, handle).pollOnce();

      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(events[1]);
      expect(await EventLog.countDocuments({})).toBe(1);
      expect(result).toMatchObject({ fetched: 2, processed: 1 });
    });

    it('pages through getEvents until the node returns no more events', async () => {
      await setCheckpoint(100);
      const events = [101, 102, 103, 104, 105].map((ledger) => buildEvent({ ledger }));
      const { rpc, getEvents } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);

      const result = await createPoller(rpc, handle, 2).pollOnce();

      expect(handle).toHaveBeenCalledTimes(5);
      expect(result.processed).toBe(5);
      expect(getEvents).toHaveBeenCalledTimes(4);
      expect(getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 101, limit: 2 });
      expect(getEvents.mock.calls[1][0]).toMatchObject({ cursor: '2' });
      expect(getEvents.mock.calls[1][0]).not.toHaveProperty('startLedger');
    });

    it('ingests the CI soak batch within throughput, latency, memory, and lag bounds without duplicate mutations', async () => {
      const eventCount = 5_000;
      const eventsPerLedger = 100;
      const startLedger = 10_000;
      const ledgerCount = eventCount / eventsPerLedger;
      const latestLedger = startLedger + ledgerCount - 1;
      const maximumLagLedgers = ledgerCount + 5;
      const events = Array.from({ length: eventCount }, (_, index) =>
        buildEvent({
          id: `soak-event-${index}`,
          txHash: `soak-tx-${index}`,
          ledger: startLedger + Math.floor(index / eventsPerLedger),
        }),
      );
      const handlerMutations = new Map<string, number>();
      const handlerLatenciesMs: number[] = [];
      const lagSamples: number[] = [];
      let maximumLag = 0;
      const initialHeapBytes = process.memoryUsage().heapUsed;
      let maximumHeapBytes = initialHeapBytes;

      await setCheckpoint(startLedger - 1);

      const rpc = {
        getLatestLedger: jest.fn(async () => ({ sequence: latestLedger })),
        getEvents: jest.fn(async (request: SorobanGetEventsRequest) => {
          const pageSize = request.limit ?? 100;
          const offset = request.cursor !== undefined ? Number(request.cursor) : 0;
          const page = events.slice(offset, offset + pageSize);
          const deliveredAt = performance.now();
          for (const event of page) {
            (event as StellarRpc.Api.EventResponse & { soakDeliveredAt?: number }).soakDeliveredAt =
              deliveredAt;
          }

          const checkpoint = await readCheckpoint();
          const lag = latestLedger - (checkpoint ?? 0);
          lagSamples.push(lag);
          maximumLag = Math.max(maximumLag, lag);
          maximumHeapBytes = Math.max(maximumHeapBytes, process.memoryUsage().heapUsed);

          return {
            latestLedger,
            events: page,
            cursor: String(offset + page.length),
          } as Awaited<ReturnType<ISorobanRpcClient['getEvents']>>;
        }),
      } as unknown as ISorobanRpcClient;

      const handle = jest.fn(async (event: StellarRpc.Api.EventResponse) => {
        const txHash = event.txHash;
        handlerMutations.set(txHash, (handlerMutations.get(txHash) ?? 0) + 1);
        const deliveredAt = (event as StellarRpc.Api.EventResponse & { soakDeliveredAt: number })
          .soakDeliveredAt;
        handlerLatenciesMs.push(performance.now() - deliveredAt);
        maximumHeapBytes = Math.max(maximumHeapBytes, process.memoryUsage().heapUsed);
      });

      const poller = createPoller(rpc, handle, 250);
      const startedAt = performance.now();
      const firstPass = await poller.pollOnce();
      const elapsedSeconds = (performance.now() - startedAt) / 1_000;
      const eventsPerSecond = firstPass.processed / elapsedSeconds;
      const p95Index = Math.ceil(handlerLatenciesMs.length * 0.95) - 1;
      const p95IngestLatencyMs = handlerLatenciesMs.sort((left, right) => left - right)[p95Index];
      const heapGrowthMb = (maximumHeapBytes - initialHeapBytes) / (1024 * 1024);

      expect(firstPass).toMatchObject({
        fromLedger: startLedger,
        toLedger: latestLedger,
        fetched: eventCount,
        processed: eventCount,
        duplicates: 0,
        failed: 0,
      });
      expect(eventsPerSecond).toBeGreaterThanOrEqual(10);
      expect(p95IngestLatencyMs).toBeLessThanOrEqual(2_500);
      expect(heapGrowthMb).toBeLessThanOrEqual(512);
      expect(maximumLag).toBeLessThanOrEqual(maximumLagLedgers);
      expect(new Set(lagSamples).size).toBe(1);
      expect(await EventLog.countDocuments({ eventType: 'escrow', status: 'processed' })).toBe(
        eventCount,
      );
      expect(await readCheckpoint()).toBe(latestLedger);

      await setCheckpoint(startLedger - 1);
      const duplicatePass = await poller.pollOnce();

      expect(duplicatePass).toMatchObject({
        fetched: eventCount,
        processed: 0,
        duplicates: eventCount,
        failed: 0,
      });
      expect(handle).toHaveBeenCalledTimes(eventCount);
      expect(handlerMutations.size).toBe(eventCount);
      expect([...handlerMutations.values()].every((count) => count === 1)).toBe(true);
      expect(await EventLog.countDocuments({ eventType: 'escrow' })).toBe(eventCount);
      expect(await readCheckpoint()).toBe(latestLedger);
    }, 120_000);

    it('does not process events beyond the latest ledger of the cycle', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 105, txHash: 'tx-head' }),
        buildEvent({ ledger: 106, txHash: 'tx-future' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);

      await createPoller(rpc, handle).pollOnce();

      expect(handle).toHaveBeenCalledTimes(1);
      expect(await EventLog.findOne({ transactionHash: 'tx-future' })).toBeNull();
      expect(await readCheckpoint()).toBe(105);
    });
  });

  describe('checkpointing', () => {
    it('starts at the ledger head when no checkpoint exists, instead of replaying history', async () => {
      const events = [
        buildEvent({ ledger: 50, txHash: 'tx-old' }),
        buildEvent({ ledger: 105, txHash: 'tx-head' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);

      const result = await createPoller(rpc, handle).pollOnce();

      expect(result.fromLedger).toBe(105);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(events[1]);
      expect(await readCheckpoint()).toBe(105);
    });

    it('makes no RPC event calls when the checkpoint is already at the head', async () => {
      await setCheckpoint(105);
      const { rpc, getEvents } = createFakeRpc(105, [buildEvent({ ledger: 105 })]);
      const handle = jest.fn();

      const result = await createPoller(rpc, handle).pollOnce();

      expect(getEvents).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
      expect(result.fetched).toBe(0);
    });

    it('leaves the checkpoint unchanged when the RPC call fails', async () => {
      await setCheckpoint(100);
      const rpc = {
        getLatestLedger: jest.fn(async () => ({ sequence: 105 })),
        getEvents: jest.fn(async () => {
          throw new Error('rpc unavailable');
        }),
      } as unknown as ISorobanRpcClient;

      await expect(createPoller(rpc, jest.fn()).pollOnce()).rejects.toThrow('rpc unavailable');
      expect(await readCheckpoint()).toBe(100);
    });
  });

  describe('deduplication and failures', () => {
    it('skips events already recorded when the checkpoint is replayed', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 101, txHash: 'tx-1' }),
        buildEvent({ ledger: 103, txHash: 'tx-2' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);
      const poller = createPoller(rpc, handle);

      await poller.pollOnce();
      await setCheckpoint(100);
      const replay = await poller.pollOnce();

      expect(handle).toHaveBeenCalledTimes(2);
      expect(replay).toMatchObject({ fetched: 2, processed: 0, duplicates: 2 });
      expect(await EventLog.countDocuments({})).toBe(2);
    });

    it('marks an event as failed with its error and still processes the others', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 101, txHash: 'tx-1' }),
        buildEvent({ ledger: 102, txHash: 'tx-2' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn(async (event: StellarRpc.Api.EventResponse) => {
        if (event.txHash === 'tx-1') throw new Error('settlement rejected');
      });

      const result = await createPoller(rpc, handle).pollOnce();

      const failed = await EventLog.findOne({ transactionHash: 'tx-1' }).lean();
      const processed = await EventLog.findOne({ transactionHash: 'tx-2' }).lean();
      expect(failed).toMatchObject({ status: 'failed', errorMessage: 'settlement rejected' });
      expect(processed?.status).toBe('processed');
      expect(result).toMatchObject({ processed: 1, failed: 1 });
      expect(await readCheckpoint()).toBe(105);
    });

    it('does not re-run a failed event on a later cycle', async () => {
      await setCheckpoint(100);
      const { rpc } = createFakeRpc(105, [buildEvent({ ledger: 101, txHash: 'tx-1' })]);
      const handle = jest.fn().mockRejectedValue(new Error('boom'));
      const poller = createPoller(rpc, handle);

      await poller.pollOnce();
      await setCheckpoint(100);
      const replay = await poller.pollOnce();

      expect(handle).toHaveBeenCalledTimes(1);
      expect(replay.duplicates).toBe(1);
    });

    it('processes an event left pending by an interrupted cycle without creating a second record', async () => {
      await setCheckpoint(100);
      await EventLog.create({
        eventType: 'escrow',
        transactionHash: 'tx-1',
        ledgerSequence: 101,
        contractId: CONTRACT_ID,
        status: 'pending',
      });
      const { rpc } = createFakeRpc(105, [buildEvent({ ledger: 101, txHash: 'tx-1' })]);
      const handle = jest.fn().mockResolvedValue(undefined);

      const result = await createPoller(rpc, handle).pollOnce();

      expect(handle).toHaveBeenCalledTimes(1);
      expect(result.processed).toBe(1);
      expect(await EventLog.countDocuments({ transactionHash: 'tx-1' })).toBe(1);
      expect((await EventLog.findOne({ transactionHash: 'tx-1' }).lean())?.status).toBe(
        'processed',
      );
    });
  });

  describe('injected fetcher', () => {
    it('reads events from the injected fetcher after the checkpoint instead of the RPC node', async () => {
      await setCheckpoint(100);
      const events = [buildEvent({ ledger: 101, txHash: 'tx-injected' })];
      const { rpc, getEvents } = createFakeRpc(105, events);
      const fetchNextEvents = jest.fn(async function* (lastLedger: number) {
        expect(lastLedger).toBe(100);
        yield* events;
      });
      const handle = jest.fn().mockResolvedValue(undefined);
      const poller = new EventPoller({
        rpc,
        network: NETWORK,
        contractId: CONTRACT_ID,
        subscriptions: [subscriptionFor(handle)],
        intervalMs: 60_000,
        pageSize: 100,
        fetchNextEvents,
      });

      const result = await poller.pollOnce();

      expect(fetchNextEvents).toHaveBeenCalledWith(100);
      expect(getEvents).not.toHaveBeenCalled();
      expect(handle).toHaveBeenCalledWith(events[0]);
      expect(result).toMatchObject({ fromLedger: 101, toLedger: 105, processed: 1 });
      expect(await readCheckpoint()).toBe(105);
    });

    it('ignores events the injected fetcher returns outside the cycle window', async () => {
      await setCheckpoint(100);
      const events = [
        buildEvent({ ledger: 100, txHash: 'tx-old' }),
        buildEvent({ ledger: 105, txHash: 'tx-head' }),
        buildEvent({ ledger: 106, txHash: 'tx-future' }),
      ];
      const { rpc } = createFakeRpc(105, events);
      const handle = jest.fn().mockResolvedValue(undefined);
      const poller = new EventPoller({
        rpc,
        network: NETWORK,
        contractId: CONTRACT_ID,
        subscriptions: [subscriptionFor(handle)],
        intervalMs: 60_000,
        pageSize: 100,
        fetchNextEvents: async function* (): AsyncGenerator<StellarRpc.Api.EventResponse> {
          yield* events;
        },
      });

      const result = await poller.pollOnce();

      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(events[1]);
      expect(result).toMatchObject({ fetched: 1, processed: 1 });
      expect(await EventLog.countDocuments({})).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('runs an immediate cycle on start and stops scheduling on stop', async () => {
      const { rpc, getLatestLedger } = createFakeRpc(100, []);
      const poller = createPoller(rpc, jest.fn());

      poller.start();
      await flush();
      expect(getLatestLedger).toHaveBeenCalledTimes(1);

      poller.stop();
      poller.stop();
      await flush();
      expect(getLatestLedger).toHaveBeenCalledTimes(1);
    });

    it('reports isRunning and schedules cycles on the configured interval', async () => {
      const intervalSpy = jest.spyOn(global, 'setInterval');
      try {
        const { rpc } = createFakeRpc(100, []);
        const poller = createPoller(rpc, jest.fn());

        expect(poller.isRunning).toBe(false);
        poller.start();
        await flush();

        expect(poller.isRunning).toBe(true);
        expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

        poller.stop();
        expect(poller.isRunning).toBe(false);
      } finally {
        intervalSpy.mockRestore();
      }
    });

    it('keeps ticking after a failed cycle', async () => {
      await setCheckpoint(100);
      const intervalSpy = jest.spyOn(global, 'setInterval');
      try {
        const { rpc } = createFakeRpc(105, []);
        const getLatestLedger = jest
          .spyOn(rpc, 'getLatestLedger')
          .mockRejectedValue(new Error('rpc unavailable'));
        const poller = createPoller(rpc, jest.fn());

        poller.start();
        await flush(100);
        expect(getLatestLedger).toHaveBeenCalledTimes(1);
        expect(poller.isRunning).toBe(true);

        const tick = intervalSpy.mock.calls[0][0] as () => void;
        tick();
        await flush(100);

        expect(getLatestLedger).toHaveBeenCalledTimes(2);
        expect(poller.isRunning).toBe(true);
        poller.stop();
      } finally {
        intervalSpy.mockRestore();
      }
    });
  });

  // ─── Jitter ───────────────────────────────────────────────────────────────

  describe('computeJitteredInterval', () => {
    it('returns exactly baseMs when ratio is 0 (no jitter)', () => {
      for (let i = 0; i < 20; i++) {
        expect(computeJitteredInterval(10_000, 0)).toBe(10_000);
      }
    });

    it('returns a value within [base*(1-ratio), base*(1+ratio)] for ratio 0.2', () => {
      const base = 10_000;
      const ratio = 0.2;
      const lo = base * (1 - ratio);
      const hi = base * (1 + ratio);
      for (let i = 0; i < 100; i++) {
        const result = computeJitteredInterval(base, ratio);
        expect(result).toBeGreaterThanOrEqual(lo);
        expect(result).toBeLessThanOrEqual(hi);
      }
    });

    it('returns a value within [base*(1-ratio), base*(1+ratio)] for ratio 0.5 (maximum allowed)', () => {
      const base = 30_000;
      const ratio = 0.5;
      const lo = base * (1 - ratio); // 15_000
      const hi = base * (1 + ratio); // 45_000
      for (let i = 0; i < 100; i++) {
        const result = computeJitteredInterval(base, ratio);
        expect(result).toBeGreaterThanOrEqual(lo);
        expect(result).toBeLessThanOrEqual(hi);
      }
    });

    it('clamps a ratio above 0.5 to 0.5', () => {
      const base = 10_000;
      const lo = base * 0.5; // 5_000
      const hi = base * 1.5; // 15_000
      for (let i = 0; i < 50; i++) {
        const result = computeJitteredInterval(base, 0.9);
        expect(result).toBeGreaterThanOrEqual(lo);
        expect(result).toBeLessThanOrEqual(hi);
      }
    });

    it('clamps a negative ratio to 0 (no jitter)', () => {
      for (let i = 0; i < 20; i++) {
        expect(computeJitteredInterval(5_000, -0.3)).toBe(5_000);
      }
    });

    it('produces varied values across multiple calls (randomness check)', () => {
      const base = 10_000;
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(computeJitteredInterval(base, 0.2));
      }
      // With a ±2000 ms window and 50 samples, the probability all land on the
      // same rounded millisecond is negligible.
      expect(results.size).toBeGreaterThan(1);
    });
  });
});
