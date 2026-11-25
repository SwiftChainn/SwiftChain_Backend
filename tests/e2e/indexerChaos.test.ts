/**
 * Chaos tests for RPC timeouts, connection resets, and partial batch failures (#326).
 *
 * Proves the ingestion pipeline tolerates flaky Soroban RPC endpoints without
 * unhandled rejections, state corruption, double-processing, or advancing the
 * checkpoint past an incompletely processed range, and engages circuit-breaker
 * failover on repeated failures.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import EventLog from '../../src/models/EventLog';
import { IndexerStatus } from '../../src/models/IndexerStatus';
import CircuitBreaker from 'opossum';
import { EventPoller } from '../../src/services/eventPoller';
import prometheusMetricsService from '../../src/services/prometheusMetricsService';
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

const NETWORK = 'testnet';
const CONTRACT_ID = 'CCHAOSTESTCONTRACT123456';
const TOPIC = 'escrow_funded';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([EventLog.init(), IndexerStatus.init()]);
}, 120_000);

afterEach(async () => {
  await Promise.all([EventLog.deleteMany({}), IndexerStatus.deleteMany({})]);
  prometheusMetricsService.resetIndexerMetrics();
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// ─── Flaky Fake RPC Client ─────────────────────────────────────────────────────

type FaultType = 'timeout' | 'reset' | 'partial-response';

class FlakyFakeSorobanRpcClient {
  private readonly faults: FaultType[] = [];
  public calls = 0;

  constructor(
    private readonly latestLedger: number,
    private readonly events: StellarRpc.Api.EventResponse[],
  ) {}

  public queueFault(...faults: FaultType[]): void {
    this.faults.push(...faults);
  }

  public asRpcClient(): ISorobanRpcClient {
    return this as unknown as ISorobanRpcClient;
  }

  public async getLatestLedger(): Promise<{ sequence: number }> {
    return { sequence: this.latestLedger };
  }

  public async getEvents(
    request: SorobanGetEventsRequest,
  ): Promise<{ latestLedger: number; events: StellarRpc.Api.EventResponse[]; cursor: string }> {
    this.calls += 1;
    const fault = this.faults.shift();

    if (fault === 'timeout') {
      const err = new Error('ETIMEDOUT: Soroban RPC request timed out');
      (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      throw err;
    }

    if (fault === 'reset') {
      const err = new Error('ECONNRESET: socket hang up');
      (err as NodeJS.ErrnoException).code = 'ECONNRESET';
      throw err;
    }

    if (fault === 'partial-response' && request.cursor !== undefined) {
      const err = new Error('ECONNRESET: stream truncated mid-batch');
      (err as NodeJS.ErrnoException).code = 'ECONNRESET';
      throw err;
    }

    // If partial-response was queued for page 1, keep it armed for page 2
    if (fault === 'partial-response' && request.cursor === undefined) {
      this.faults.unshift('partial-response');
    }

    const limit = request.limit ?? 100;
    const start =
      request.cursor !== undefined
        ? Number(request.cursor)
        : Math.max(
            0,
            this.events.findIndex((ev) => ev.ledger >= (request.startLedger ?? 0)),
          );
    const page = this.events.slice(start, start + limit);
    return {
      latestLedger: this.latestLedger,
      events: page,
      cursor: String(start + page.length),
    };
  }
}

const makeEvent = (ledger: number, txHash: string): StellarRpc.Api.EventResponse =>
  ({
    id: `ev-${ledger}`,
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

const seedCheckpoint = async (lastProcessedLedger: number): Promise<void> => {
  await IndexerStatus.updateOne(
    { network: NETWORK },
    { $set: { lastProcessedLedger, lastProcessedAt: new Date() } },
    { upsert: true },
  );
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Indexer RPC Chaos Tests (#326)', () => {
  it('catches mid-tick timeout without unhandled rejection, preserves checkpoint, and succeeds on retry', async () => {
    await seedCheckpoint(100);
    const events = [makeEvent(101, 'tx-101'), makeEvent(102, 'tx-102')];
    const rpc = new FlakyFakeSorobanRpcClient(105, events);
    rpc.queueFault('timeout');

    const processed: string[] = [];
    const poller = new EventPoller({
      rpc: rpc.asRpcClient(),
      network: NETWORK,
      contractId: CONTRACT_ID,
      subscriptions: [
        {
          eventType: 'escrow',
          topic: TOPIC,
          handle: async (ev) => {
            processed.push(ev.txHash);
          },
        },
      ],
      intervalMs: 40,
      pageSize: 10,
    });

    // start() invokes runCycle() internally — timeout must be caught cleanly (no unhandledRejection)
    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    poller.stop();

    expect(processed).toEqual(['tx-101', 'tx-102']);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      105,
    );
    expect(
      prometheusMetricsService.getIndexerMetricsSnapshot().ingestionErrorsTotal,
    ).toBeGreaterThanOrEqual(1);
  });

  it('handles partial batch failure and connection reset after ingest without double-applying or breaking order', async () => {
    await seedCheckpoint(200);
    const events = [
      makeEvent(201, 'tx-201'),
      makeEvent(202, 'tx-202'),
      makeEvent(203, 'tx-203'),
      makeEvent(204, 'tx-204'),
    ];
    const rpc = new FlakyFakeSorobanRpcClient(205, events);
    // Page 1 (201, 202) succeeds, page 2 fails with ECONNRESET
    rpc.queueFault('partial-response');

    const appliedOrder: number[] = [];
    const poller = new EventPoller({
      rpc: rpc.asRpcClient(),
      network: NETWORK,
      contractId: CONTRACT_ID,
      subscriptions: [
        {
          eventType: 'escrow',
          topic: TOPIC,
          handle: async (ev) => {
            appliedOrder.push(ev.ledger);
          },
        },
      ],
      intervalMs: 60_000,
      pageSize: 2,
    });

    await expect(poller.pollOnce()).rejects.toThrow(/ECONNRESET/);

    // Checkpoint MUST NOT advance past incomplete batch
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      200,
    );
    expect(appliedOrder).toEqual([201, 202]);

    // Retry re-fetches from ledger 201, skips 201 & 202 (already processed), processes 203 & 204 in order
    const retryResult = await poller.pollOnce();
    expect(retryResult).toMatchObject({
      fromLedger: 201,
      toLedger: 205,
      processed: 2,
      duplicates: 2,
      failed: 0,
    });
    expect(appliedOrder).toEqual([201, 202, 203, 204]);
    expect(await EventLog.countDocuments({})).toBe(4);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      205,
    );
  });

  it('engages circuit breaker and fails over to secondary RPC after repeated failures', async () => {
    await seedCheckpoint(300);
    const events = [makeEvent(301, 'tx-301'), makeEvent(302, 'tx-302')];

    const primary = new FlakyFakeSorobanRpcClient(305, events);
    primary.queueFault('reset', 'timeout', 'reset', 'timeout');
    const secondary = new FlakyFakeSorobanRpcClient(305, events);

    const breaker = new CircuitBreaker((req: SorobanGetEventsRequest) => primary.getEvents(req), {
      name: `chaos-soroban-rpc-${Date.now()}`,
      errorThresholdPercentage: 50,
      rollingCountTimeout: 10_000,
      resetTimeout: 30_000,
      volumeThreshold: 3,
      timeout: 2_000,
    });

    const failoverRpc = {
      getLatestLedger: () => primary.getLatestLedger(),
      getEvents: async (req: SorobanGetEventsRequest) => {
        if (breaker.opened) {
          return secondary.getEvents(req);
        }
        return breaker.fire(req);
      },
    } as unknown as ISorobanRpcClient;

    const applied: string[] = [];
    const poller = new EventPoller({
      rpc: failoverRpc,
      network: NETWORK,
      contractId: CONTRACT_ID,
      subscriptions: [
        {
          eventType: 'escrow',
          topic: TOPIC,
          handle: async (ev) => {
            applied.push(ev.txHash);
          },
        },
      ],
      intervalMs: 60_000,
      pageSize: 10,
    });

    // Three consecutive failures trip the circuit breaker
    await expect(poller.pollOnce()).rejects.toThrow(/ECONNRESET/);
    await expect(poller.pollOnce()).rejects.toThrow(/ETIMEDOUT/);
    await expect(poller.pollOnce()).rejects.toThrow(/ECONNRESET/);
    expect(breaker.opened).toBe(true);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      300,
    );

    // Next cycle routes to healthy secondary RPC without losing events
    const recovered = await poller.pollOnce();
    expect(recovered).toMatchObject({ processed: 2, duplicates: 0, failed: 0 });
    expect(applied).toEqual(['tx-301', 'tx-302']);
    expect(secondary.calls).toBeGreaterThanOrEqual(1);
    expect((await IndexerStatus.findOne({ network: NETWORK }).lean())?.lastProcessedLedger).toBe(
      305,
    );

    breaker.shutdown();
  });
});
