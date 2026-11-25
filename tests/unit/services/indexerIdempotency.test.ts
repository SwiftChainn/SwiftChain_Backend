/**
 * Event re-delivery idempotency tests (#340).
 *
 * Exercises every event family (escrow funded/released/refunded, delivery
 * created/status_updated, dispute opened/resolved, reputation increased/slashed)
 * against a real in-memory MongoDB with EventLog's unique
 * `{ transactionHash, eventType }` dedupe index and persisted IndexerStatus.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { nativeToScVal, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import EventLog from '../../../src/models/EventLog';
import { IndexerStatus } from '../../../src/models/IndexerStatus';
import { Delivery, DeliveryStatus } from '../../../src/models/Delivery';
import Escrow, { EscrowStatus } from '../../../src/models/Escrow';
import Dispute from '../../../src/models/Dispute';
import DriverProfile from '../../../src/models/DriverProfile';
import {
  ConflictingEventReplayError,
  EventPoller,
  EventSubscription,
  IndexedEventType,
} from '../../../src/services/eventPoller';
import {
  handleEscrowFundedEvent,
  handleEscrowRefundedEvent,
  handleEscrowReleasedEvent,
} from '../../../src/indexer/escrowHandlers';
import { deliveryHandlers } from '../../../src/indexer/deliveryHandlers';
import { handleDisputeOpened, handleDisputeResolved } from '../../../src/indexer/disputeHandlers';
import type {
  ISorobanRpcClient,
  SorobanGetEventsRequest,
} from '../../../src/services/providers/sorobanRpcClient';

jest.mock('../../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const NETWORK = 'testnet';
const CONTRACT_ID = 'CIDEMPOTENCYCONTRACT123456';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    EventLog.init(),
    IndexerStatus.init(),
    Delivery.init(),
    Escrow.init(),
    DriverProfile.init(),
  ]);
}, 120_000);

afterEach(async () => {
  await Promise.all([
    EventLog.deleteMany({}),
    IndexerStatus.deleteMany({}),
    Delivery.deleteMany({}),
    Escrow.deleteMany({}),
    Dispute.deleteMany({}),
    DriverProfile.deleteMany({}),
  ]);
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

const makeEvent = (params: {
  id: string;
  ledger: number;
  txHash: string;
  topic: string;
  extraTopics?: xdr.ScVal[];
  value: xdr.ScVal;
}): StellarRpc.Api.EventResponse =>
  ({
    id: params.id,
    type: 'contract',
    ledger: params.ledger,
    ledgerClosedAt: '2026-11-25T00:00:00Z',
    contractId: CONTRACT_ID,
    txHash: params.txHash,
    topic: [xdr.ScVal.scvSymbol(params.topic), ...(params.extraTopics ?? [])],
    value: params.value,
    inSuccessfulContractCall: true,
    pagingToken: params.id,
  }) as unknown as StellarRpc.Api.EventResponse;

const createRpc = (
  latestLedger: number,
  events: StellarRpc.Api.EventResponse[],
): ISorobanRpcClient =>
  ({
    getLatestLedger: jest.fn(async () => ({ sequence: latestLedger })),
    getEvents: jest.fn(async (req: SorobanGetEventsRequest) => {
      const start =
        req.cursor !== undefined
          ? Number(req.cursor)
          : Math.max(
              0,
              events.findIndex((ev) => ev.ledger >= (req.startLedger ?? 0)),
            );
      const limit = req.limit ?? 100;
      const page = events.slice(start, start + limit);
      return { latestLedger, events: page, cursor: String(start + page.length) };
    }),
  }) as unknown as ISorobanRpcClient;

const seedCheckpoint = async (lastProcessedLedger: number): Promise<void> => {
  await IndexerStatus.updateOne(
    { network: NETWORK },
    { $set: { lastProcessedLedger, lastProcessedAt: new Date() } },
    { upsert: true },
  );
};

const seedDelivery = async (deliveryId: string) =>
  Delivery.create({
    deliveryId,
    sender: new mongoose.Types.ObjectId(),
    recipient: new mongoose.Types.ObjectId(),
    pickupCoordinates: { lat: 6.45, lng: 3.39, address: '10 Marina Way' },
    dropoffCoordinates: { lat: 6.43, lng: 3.42, address: '20 Victoria Island' },
    status: DeliveryStatus.PENDING,
  });

const createPoller = (rpc: ISorobanRpcClient, subscriptions: EventSubscription[]): EventPoller =>
  new EventPoller({
    rpc,
    network: NETWORK,
    contractId: CONTRACT_ID,
    subscriptions,
    intervalMs: 60_000,
    pageSize: 100,
  });

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Indexer Event Re-delivery Idempotency (#340)', () => {
  it('deduplicates escrow_funded, escrow_released, and escrow_refunded on duplicate delivery and after restart', async () => {
    const fundedDelivery = await seedDelivery('del-funded');
    const releasedDelivery = await seedDelivery('del-released');
    const refundedDelivery = await seedDelivery('del-refunded');

    const [releasedEscrow, refundedEscrow] = await Escrow.create([
      {
        delivery: releasedDelivery._id,
        contractId: 'CRELEASEDCONTRACT1',
        amount: 250,
        assetCode: 'XLM',
        asset: 'XLM',
        status: EscrowStatus.LOCKED,
      },
      {
        delivery: refundedDelivery._id,
        contractId: 'CREFUNDEDCONTRACT1',
        amount: 180,
        assetCode: 'XLM',
        asset: 'XLM',
        status: EscrowStatus.LOCKED,
      },
    ]);

    const fundedEvent = makeEvent({
      id: 'ev-funded-1',
      ledger: 201,
      txHash: 'tx-escrow-funded-1',
      topic: 'escrow_funded',
      extraTopics: [nativeToScVal(fundedDelivery._id.toString(), { type: 'string' })],
      value: nativeToScVal({ amount: 500, asset: 'XLM', funded_by: 'GFUNDER1' }),
    });
    const releasedEvent = makeEvent({
      id: 'ev-released-1',
      ledger: 202,
      txHash: 'tx-escrow-released-1',
      topic: 'escrow_released',
      extraTopics: [nativeToScVal(releasedEscrow._id.toString(), { type: 'string' })],
      value: nativeToScVal({
        amount: 250,
        asset: 'XLM',
        recipient: 'GDRIVER1',
        transaction_hash: 'tx-escrow-released-1',
        ledger: 202,
        timestamp: 1700000000,
      }),
    });
    const refundedEvent = makeEvent({
      id: 'ev-refunded-1',
      ledger: 203,
      txHash: 'tx-escrow-refunded-1',
      topic: 'escrow_refunded',
      extraTopics: [nativeToScVal(refundedEscrow._id.toString(), { type: 'string' })],
      value: nativeToScVal({
        amount: 180,
        asset: 'XLM',
        recipient: 'GSENDER1',
        transaction_hash: 'tx-escrow-refunded-1',
        ledger: 203,
        timestamp: 1700000001,
      }),
    });

    const handleFunded = jest.fn((ev) => handleEscrowFundedEvent(ev, CONTRACT_ID));
    const handleReleased = jest.fn((ev) => handleEscrowReleasedEvent(ev));
    const handleRefunded = jest.fn((ev) => handleEscrowRefundedEvent(ev));

    const subscriptions: EventSubscription[] = [
      { eventType: 'escrow', topic: 'escrow_funded', handle: handleFunded },
      { eventType: 'escrow', topic: 'escrow_released', handle: handleReleased },
      { eventType: 'escrow', topic: 'escrow_refunded', handle: handleRefunded },
    ];

    const rpc = createRpc(205, [fundedEvent, releasedEvent, refundedEvent]);

    await seedCheckpoint(200);
    const first = await createPoller(rpc, subscriptions).pollOnce();
    expect(first).toMatchObject({ processed: 3, duplicates: 0, failed: 0 });

    // Rewind checkpoint to simulate identical re-delivery in the same instance
    await seedCheckpoint(200);
    const second = await createPoller(rpc, subscriptions).pollOnce();
    expect(second).toMatchObject({ processed: 0, duplicates: 3, failed: 0 });

    // Simulate fresh container restart from persisted MongoDB state
    await seedCheckpoint(200);
    const afterRestart = await createPoller(rpc, subscriptions).pollOnce();
    expect(afterRestart).toMatchObject({ processed: 0, duplicates: 3, failed: 0 });

    expect(handleFunded).toHaveBeenCalledTimes(1);
    expect(handleReleased).toHaveBeenCalledTimes(1);
    expect(handleRefunded).toHaveBeenCalledTimes(1);
    expect(await EventLog.countDocuments({ eventType: 'escrow' })).toBe(3);
    expect((await Escrow.findOne({ delivery: fundedDelivery._id }).lean())?.status).toBe(
      EscrowStatus.LOCKED,
    );
    expect((await Escrow.findOne({ delivery: releasedDelivery._id }).lean())?.status).toBe(
      EscrowStatus.RELEASED,
    );
    expect((await Escrow.findOne({ delivery: refundedDelivery._id }).lean())?.status).toBe(
      EscrowStatus.REFUNDED,
    );
  });

  it('deduplicates delivery_status_updated events across duplicate delivery and restart', async () => {
    await seedDelivery('del-status-1');

    const statusEvent = makeEvent({
      id: 'ev-del-1',
      ledger: 301,
      txHash: 'tx-delivery-status-1',
      topic: 'delivery_status_updated',
      value: nativeToScVal({ delivery_id: 'del-status-1', status: DeliveryStatus.IN_PROGRESS }),
    });

    const handleDelivery = jest.fn((ev: StellarRpc.Api.EventResponse) =>
      deliveryHandlers.processDeliveryStatusUpdatedEvent(ev.value.toXDR('base64')),
    );
    const subscriptions: EventSubscription[] = [
      { eventType: 'delivery', topic: 'delivery_status_updated', handle: handleDelivery },
    ];
    const rpc = createRpc(305, [statusEvent, statusEvent]);

    await seedCheckpoint(300);
    const first = await createPoller(rpc, subscriptions).pollOnce();
    expect(first).toMatchObject({ fetched: 2, processed: 1, duplicates: 1, failed: 0 });

    // Fresh poller instance after restart
    await seedCheckpoint(300);
    const restart = await createPoller(rpc, subscriptions).pollOnce();
    expect(restart).toMatchObject({ fetched: 2, processed: 0, duplicates: 2, failed: 0 });

    expect(handleDelivery).toHaveBeenCalledTimes(1);
    expect(await EventLog.countDocuments({ eventType: 'delivery' })).toBe(1);
    expect((await Delivery.findOne({ deliveryId: 'del-status-1' }).lean())?.status).toBe(
      DeliveryStatus.IN_PROGRESS,
    );
  });

  it('deduplicates dispute_opened and dispute_resolved events across duplicate delivery and restart', async () => {
    await seedDelivery('del-disp-1');

    const openEvent = makeEvent({
      id: 'ev-disp-open-1',
      ledger: 401,
      txHash: 'tx-dispute-open-1',
      topic: 'dispute_opened',
      value: nativeToScVal({
        dispute_id: 'disp-1',
        delivery_id: 'del-disp-1',
        reason: 'Damaged parcel',
      }),
    });
    const resolveEvent = makeEvent({
      id: 'ev-disp-res-1',
      ledger: 402,
      txHash: 'tx-dispute-resolve-1',
      topic: 'dispute_resolved',
      value: nativeToScVal({
        dispute_id: 'disp-1',
        resolution: 'refund_sender',
      }),
    });

    const handleOpen = jest.fn(async (ev: StellarRpc.Api.EventResponse) => {
      await handleDisputeOpened({
        disputeId: 'disp-1',
        deliveryId: 'del-disp-1',
        reason: 'Damaged parcel',
        ledgerSequence: ev.ledger,
      });
    });
    const handleResolve = jest.fn(async (ev: StellarRpc.Api.EventResponse) => {
      await handleDisputeResolved({
        disputeId: 'disp-1',
        resolution: 'refund_sender',
        ledgerSequence: ev.ledger,
      });
    });

    const subscriptions: EventSubscription[] = [
      { eventType: 'dispute', topic: 'dispute_opened', handle: handleOpen },
      { eventType: 'dispute', topic: 'dispute_resolved', handle: handleResolve },
    ];
    const rpc = createRpc(405, [openEvent, resolveEvent]);

    await seedCheckpoint(400);
    const first = await createPoller(rpc, subscriptions).pollOnce();
    expect(first).toMatchObject({ processed: 2, duplicates: 0, failed: 0 });

    await seedCheckpoint(400);
    const afterRestart = await createPoller(rpc, subscriptions).pollOnce();
    expect(afterRestart).toMatchObject({ processed: 0, duplicates: 2, failed: 0 });

    expect(handleOpen).toHaveBeenCalledTimes(1);
    expect(handleResolve).toHaveBeenCalledTimes(1);
    expect(await EventLog.countDocuments({ eventType: 'dispute' })).toBe(2);
    expect(await Dispute.countDocuments({ disputeId: 'disp-1' })).toBe(1);
  });

  it('deduplicates reputation events so points are incremented exactly once', async () => {
    const driverId = new mongoose.Types.ObjectId();
    await DriverProfile.create({ userId: driverId, reputationPoints: 10 });

    const repEvent = makeEvent({
      id: 'ev-rep-1',
      ledger: 501,
      txHash: 'tx-reputation-1',
      topic: 'reputation_increased',
      value: nativeToScVal({ driver_id: driverId.toString(), points: 25 }),
    });

    const handleRep = jest.fn(async () => {
      await DriverProfile.updateOne({ userId: driverId }, { $inc: { reputationPoints: 25 } });
    });

    const subscriptions: EventSubscription[] = [
      { eventType: 'reputation', topic: 'reputation_increased', handle: handleRep },
    ];
    const rpc = createRpc(505, [repEvent, repEvent]);

    await seedCheckpoint(500);
    await createPoller(rpc, subscriptions).pollOnce();

    // Restart with fresh poller and re-deliver
    await seedCheckpoint(500);
    const restart = await createPoller(rpc, subscriptions).pollOnce();
    expect(restart).toMatchObject({ processed: 0, duplicates: 2 });

    expect(handleRep).toHaveBeenCalledTimes(1);
    expect(await EventLog.countDocuments({ eventType: 'reputation' })).toBe(1);
    expect((await DriverProfile.findOne({ userId: driverId }).lean())?.reputationPoints).toBe(35);
  });

  it('detects and rejects conflicting late replays (same hash, mutated payload) without mutating state', async () => {
    const conflictDelivery = await seedDelivery('del-conflict-1');

    const originalEvent = makeEvent({
      id: 'ev-conflict-1',
      ledger: 601,
      txHash: 'tx-conflict-hash',
      topic: 'escrow_funded',
      extraTopics: [nativeToScVal(conflictDelivery._id.toString(), { type: 'string' })],
      value: nativeToScVal({ amount: 100, asset: 'XLM', funded_by: 'GFUNDER1' }),
    });

    const mutatedReplay = makeEvent({
      id: 'ev-conflict-1',
      ledger: 601,
      txHash: 'tx-conflict-hash',
      topic: 'escrow_funded',
      extraTopics: [nativeToScVal(conflictDelivery._id.toString(), { type: 'string' })],
      value: nativeToScVal({ amount: 9999, asset: 'XLM', funded_by: 'GATTACKER' }),
    });

    const handleFunded = jest.fn((ev) => handleEscrowFundedEvent(ev, CONTRACT_ID));
    const subscriptions: EventSubscription[] = [
      {
        eventType: 'escrow' as IndexedEventType,
        topic: 'escrow_funded',
        handle: handleFunded,
      },
    ];

    await seedCheckpoint(600);
    await createPoller(createRpc(605, [originalEvent]), subscriptions).pollOnce();
    expect((await Escrow.findOne({ delivery: conflictDelivery._id }).lean())?.amount).toBe(100);

    // Rewind checkpoint and deliver conflicting payload with the same txHash + eventType
    await seedCheckpoint(600);
    await expect(
      createPoller(createRpc(605, [mutatedReplay]), subscriptions).pollOnce(),
    ).rejects.toThrow(ConflictingEventReplayError);

    // Handler was never called a second time and stored escrow amount is untouched
    expect(handleFunded).toHaveBeenCalledTimes(1);
    expect((await Escrow.findOne({ delivery: conflictDelivery._id }).lean())?.amount).toBe(100);
    expect(await EventLog.countDocuments({ transactionHash: 'tx-conflict-hash' })).toBe(1);
  });
});
