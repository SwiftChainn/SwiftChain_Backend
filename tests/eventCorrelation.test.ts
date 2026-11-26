/**
 * Integration tests for the Event Correlation Layer (#334).
 *
 * Covers:
 * - Recording & querying correlations across all event families:
 *   delivery, escrow, dispute, reputation.
 * - Auto-population during EventPoller ingestion.
 * - Unknown transaction hashes & unknown entities returning empty results cleanly.
 * - Event-log API and Admin Explorer API endpoints (versioned /api/v1/...).
 */

import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { nativeToScVal, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import app from '../src/app';
import env from '../src/config/env';
import EventLog from '../src/models/EventLog';
import EventCorrelation from '../src/models/EventCorrelation';
import { IndexerStatus } from '../src/models/IndexerStatus';
import { eventCorrelationService } from '../src/services/eventCorrelationService';
import { EventPoller } from '../src/services/eventPoller';
import { UserRole } from '../src/interfaces/IUser';
import User from '../src/models/User';
import type {
  ISorobanRpcClient,
  SorobanGetEventsRequest,
} from '../src/services/providers/sorobanRpcClient';

jest.mock('../src/config/database', () => ({
  connectDatabase: jest.fn(),
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const CONTRACT_ID = 'CCORRELATIONTESTCONTRACT000000000000000000000000000000001';

let mongoServer: MongoMemoryServer;
let adminToken: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([EventLog.init(), EventCorrelation.init(), IndexerStatus.init()]);

  const adminUser = await User.create({
    firstName: 'Admin',
    lastName: 'Explorer',
    email: 'admin-explorer@swiftchain.test',
    password: 'StrongPassword123!',
    role: UserRole.ADMIN,
    isEmailVerified: true,
  });

  adminToken = jwt.sign({ userId: String(adminUser._id), role: UserRole.ADMIN }, env.JWT_SECRET, {
    expiresIn: '1h',
  });
}, 120_000);

afterEach(async () => {
  await Promise.all([
    EventLog.deleteMany({}),
    EventCorrelation.deleteMany({}),
    IndexerStatus.deleteMany({}),
  ]);
});

afterAll(async () => {
  await User.deleteMany({});
  await mongoose.disconnect();
  await mongoServer.stop();
});

function makeEvent(params: {
  id: string;
  ledger: number;
  txHash: string;
  topic: string;
  entityId: string;
}): StellarRpc.Api.EventResponse {
  return {
    id: params.id,
    type: 'contract',
    ledger: params.ledger,
    ledgerClosedAt: '2026-11-24T10:00:00Z',
    contractId: CONTRACT_ID,
    txHash: params.txHash,
    topic: [xdr.ScVal.scvSymbol(params.topic), nativeToScVal(params.entityId, { type: 'string' })],
    value: nativeToScVal({ id: params.entityId }),
    inSuccessfulContractCall: true,
    pagingToken: params.id,
  } as unknown as StellarRpc.Api.EventResponse;
}

describe('EventCorrelationService & APIs (#334)', () => {
  it('populates correlation index during ingestion for all event families and resolves both directions', async () => {
    const events: StellarRpc.Api.EventResponse[] = [
      makeEvent({
        id: 'evt-1',
        ledger: 1001,
        txHash: 'tx-delivery-1',
        topic: 'delivery_created',
        entityId: 'DLV-CORR-1',
      }),
      makeEvent({
        id: 'evt-2',
        ledger: 1002,
        txHash: 'tx-escrow-1',
        topic: 'escrow_funded',
        entityId: 'ESC-CORR-1',
      }),
      makeEvent({
        id: 'evt-3',
        ledger: 1003,
        txHash: 'tx-dispute-1',
        topic: 'dispute_opened',
        entityId: 'DSP-CORR-1',
      }),
      makeEvent({
        id: 'evt-4',
        ledger: 1004,
        txHash: 'tx-reputation-1',
        topic: 'reputation_increased',
        entityId: 'GDRIVER123456',
      }),
    ];

    const rpc = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1004 }),
      getEvents: jest.fn().mockImplementation(async (req: SorobanGetEventsRequest) => ({
        latestLedger: 1004,
        events: req.cursor ? [] : events,
        cursor: 'end',
      })),
    } as unknown as ISorobanRpcClient;

    await IndexerStatus.create({
      network: 'testnet',
      lastProcessedLedger: 1000,
      lastProcessedAt: new Date(),
    });

    const poller = new EventPoller({
      rpc,
      network: 'testnet',
      contractId: CONTRACT_ID,
      subscriptions: [
        {
          eventType: 'delivery',
          topic: 'delivery_created',
          handle: jest.fn().mockResolvedValue(null),
        },
        { eventType: 'escrow', topic: 'escrow_funded', handle: jest.fn().mockResolvedValue(null) },
        {
          eventType: 'dispute',
          topic: 'dispute_opened',
          handle: jest.fn().mockResolvedValue(null),
        },
        {
          eventType: 'reputation',
          topic: 'reputation_increased',
          handle: jest.fn().mockResolvedValue(null),
        },
      ],
      intervalMs: 60_000,
      pageSize: 100,
    });

    const summary = await poller.pollOnce();
    expect(summary.processed).toBe(4);

    // Forward lookup: txHash -> affected entities
    const deliveryTx = await eventCorrelationService.getEntitiesForTx('tx-delivery-1');
    expect(deliveryTx.entities).toHaveLength(1);
    expect(deliveryTx.entities[0]).toMatchObject({
      entityType: 'delivery',
      entityId: 'DLV-CORR-1',
      ledgerSequence: 1001,
    });
    expect(deliveryTx.events).toHaveLength(1);

    const escrowTx = await eventCorrelationService.getEntitiesForTx('tx-escrow-1');
    expect(escrowTx.entities[0]).toMatchObject({ entityType: 'escrow', entityId: 'ESC-CORR-1' });

    const disputeTx = await eventCorrelationService.getEntitiesForTx('tx-dispute-1');
    expect(disputeTx.entities[0]).toMatchObject({ entityType: 'dispute', entityId: 'DSP-CORR-1' });

    const repTx = await eventCorrelationService.getEntitiesForTx('tx-reputation-1');
    expect(repTx.entities[0]).toMatchObject({
      entityType: 'reputation',
      entityId: 'GDRIVER123456',
    });

    // Reverse lookup: (entityType, entityId) -> events
    const disputeEvents = await eventCorrelationService.getEventsForEntity('dispute', 'DSP-CORR-1');
    expect(disputeEvents.correlations).toHaveLength(1);
    expect(disputeEvents.events).toHaveLength(1);
    expect(disputeEvents.events[0].transactionHash).toBe('tx-dispute-1');

    // Ledger range lookup
    const rangeResult = await eventCorrelationService.getEntitiesForLedgerRange(1001, 1003);
    expect(rangeResult.entities).toHaveLength(3);
  });

  it('returns empty results cleanly for unknown transaction hashes and entities', async () => {
    const unknownTx = await eventCorrelationService.getEntitiesForTx('tx-does-not-exist');
    expect(unknownTx).toEqual({
      transactionHash: 'tx-does-not-exist',
      entities: [],
      events: [],
    });

    const unknownEntity = await eventCorrelationService.getEventsForEntity('escrow', 'ESC-MISSING');
    expect(unknownEntity).toEqual({
      entityType: 'escrow',
      entityId: 'ESC-MISSING',
      correlations: [],
      events: [],
    });
  });

  it('exposes correlation lookups on both event-log and admin explorer /api/v1 endpoints', async () => {
    const log = await EventLog.create({
      eventType: 'escrow',
      transactionHash: 'tx-api-corr-1',
      ledgerSequence: 2050,
      contractId: CONTRACT_ID,
      status: 'processed',
    });

    await eventCorrelationService.recordCorrelation({
      contractId: CONTRACT_ID,
      transactionHash: 'tx-api-corr-1',
      ledgerSequence: 2050,
      eventType: 'escrow',
      eventLogId: log._id,
      topic: 'escrow_funded',
      entityType: 'escrow',
      entityId: 'ESC-API-1',
    });

    // Event-log API: tx -> entities
    const txRes = await request(app)
      .get('/api/v1/eventlog/transaction/tx-api-corr-1/correlations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(txRes.status).toBe(200);
    expect(txRes.body.data.entities).toHaveLength(1);
    expect(txRes.body.data.entities[0].entityId).toBe('ESC-API-1');

    // Event-log API: entity -> events
    const entityRes = await request(app)
      .get('/api/v1/eventlog/entity/escrow/ESC-API-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(entityRes.status).toBe(200);
    expect(entityRes.body.data.events).toHaveLength(1);
    expect(entityRes.body.data.events[0].transactionHash).toBe('tx-api-corr-1');

    // Admin explorer API: tx, ledger range, entity
    const explorerTx = await request(app)
      .get('/api/v1/admin/explorer/transactions/tx-api-corr-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(explorerTx.status).toBe(200);
    expect(explorerTx.body.data.entities[0].entityId).toBe('ESC-API-1');

    const explorerLedgers = await request(app)
      .get('/api/v1/admin/explorer/ledgers?startLedger=2040&endLedger=2060&eventType=escrow')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(explorerLedgers.status).toBe(200);
    expect(explorerLedgers.body.data.entities).toHaveLength(1);

    // Invalid entityType returns 400
    const badType = await request(app)
      .get('/api/v1/admin/explorer/entities/unknown_family/123')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(badType.status).toBe(400);
  });
});
