import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { nativeToScVal, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import {
  EventPayloadValidationError,
  validateEventPayload,
  validateSorobanEventPayload,
} from '../src/validators/eventSchemas';
import { DeliveryStatus } from '../src/models/Delivery';
import EventLog from '../src/models/EventLog';
import { IndexerStatus } from '../src/models/IndexerStatus';
import { EventPoller } from '../src/services/eventPoller';
import type {
  ISorobanRpcClient,
  SorobanGetEventsRequest,
} from '../src/services/providers/sorobanRpcClient';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Event payload Zod validation (#341)', () => {
  describe('schema validation by family', () => {
    it('accepts valid escrow_funded, escrow_released, and escrow_refunded payloads', () => {
      const funded = validateEventPayload('escrow', 'escrow_funded', {
        deliveryId: 'DEL-100',
        amount: 500n,
        asset: 'XLM',
        fundedBy: 'GFUNDER123',
      });
      expect(funded).toMatchObject({ deliveryId: 'DEL-100', amount: 500, asset: 'XLM' });

      const released = validateEventPayload('escrow', 'escrow_released', {
        escrowId: 'ESC-1',
        amount: 250000000n,
        asset: 'XLM',
        recipient: 'GRECIPIENT123',
        transactionHash: 'tx-rel-1',
        ledger: 4200,
        timestamp: 1700000000,
      });
      expect(released).toMatchObject({ escrowId: 'ESC-1', amount: '250000000' });

      const refunded = validateEventPayload('escrow', 'escrow_refunded', {
        escrowId: 'ESC-2',
        amount: '10000000',
        asset: 'USDC',
        recipient: 'GBUYER123',
        transactionHash: 'tx-ref-2',
        ledger: 4201,
        timestamp: 1700000010,
      });
      expect(refunded).toMatchObject({ escrowId: 'ESC-2', amount: '10000000' });
    });

    it('rejects malformed escrow payloads with offending fields', () => {
      try {
        validateEventPayload('escrow', 'escrow_funded', {
          deliveryId: '',
          amount: -10,
          asset: 123,
        });
        fail('Expected EventPayloadValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(EventPayloadValidationError);
        const validationErr = err as EventPayloadValidationError;
        expect(validationErr.eventType).toBe('escrow');
        expect(validationErr.topic).toBe('escrow_funded');
        const fields = validationErr.issues.map((i) => i.field);
        expect(fields).toEqual(expect.arrayContaining(['deliveryId', 'amount', 'asset']));
      }

      expect(() =>
        validateEventPayload('escrow', 'escrow_released', {
          escrowId: 'ESC-1',
          amount: 'not-a-stroop',
          asset: 'XLM',
          recipient: 'GRECIP',
          transactionHash: 'tx-1',
          ledger: -1,
          timestamp: 100,
        }),
      ).toThrow(EventPayloadValidationError);
    });

    it('accepts valid delivery payloads and rejects unknown status or missing ids', () => {
      expect(
        validateEventPayload('delivery', 'delivery_created', {
          delivery_id: 'DEL-1',
          contract_id: 'C-CONTRACT-1',
        }),
      ).toEqual({ delivery_id: 'DEL-1', contract_id: 'C-CONTRACT-1' });

      expect(
        validateEventPayload('delivery', 'delivery_status_updated', {
          delivery_id: 'DEL-1',
          status: DeliveryStatus.COMPLETED,
        }),
      ).toEqual({ delivery_id: 'DEL-1', status: DeliveryStatus.COMPLETED });

      expect(() =>
        validateEventPayload('delivery', 'delivery_status_updated', {
          delivery_id: 'DEL-1',
          status: 'teleported',
        }),
      ).toThrow(EventPayloadValidationError);

      expect(() =>
        validateEventPayload('delivery', 'delivery_created', {
          delivery_id: 'DEL-1',
        }),
      ).toThrow(EventPayloadValidationError);
    });

    it('accepts valid dispute payloads and rejects missing required fields', () => {
      expect(
        validateEventPayload('dispute', 'dispute_opened', {
          disputeId: 'DISP-1',
          deliveryId: 'DEL-1',
          openedBy: 'GUSER1',
          reason: 'Package damaged',
          ledgerSequence: 900,
        }),
      ).toMatchObject({ disputeId: 'DISP-1', deliveryId: 'DEL-1' });

      expect(
        validateEventPayload('dispute', 'dispute_resolved', {
          disputeId: 'DISP-1',
          resolution: 'refunded',
          ledgerSequence: 910,
        }),
      ).toMatchObject({ disputeId: 'DISP-1', resolution: 'refunded' });

      expect(() =>
        validateEventPayload('dispute', 'dispute_opened', {
          disputeId: '',
          deliveryId: 'DEL-1',
          ledgerSequence: -5,
        }),
      ).toThrow(EventPayloadValidationError);
    });

    it('accepts valid reputation payloads and rejects non-positive points', () => {
      expect(
        validateEventPayload('reputation', 'reputation_increased', {
          driverAddress: 'GDRIVER123',
          points: 15,
          ledgerSequence: 1200,
        }),
      ).toEqual({ driverAddress: 'GDRIVER123', points: 15, ledgerSequence: 1200 });

      expect(
        validateEventPayload('reputation', 'reputation_slashed', {
          driverAddress: 'GDRIVER123',
          points: 5,
          ledgerSequence: 1201,
        }),
      ).toEqual({ driverAddress: 'GDRIVER123', points: 5, ledgerSequence: 1201 });

      expect(() =>
        validateEventPayload('reputation', 'reputation_increased', {
          driverAddress: 'GDRIVER123',
          points: 0,
          ledgerSequence: 1200,
        }),
      ).toThrow(EventPayloadValidationError);
    });

    it('validates Soroban EventResponse XDR payloads directly', () => {
      const validEvent = {
        id: 'evt-1',
        type: 'contract',
        ledger: 500,
        ledgerClosedAt: '2026-11-24T00:00:00Z',
        contractId: 'CTEST',
        txHash: 'tx-valid',
        topic: [xdr.ScVal.scvSymbol('escrow_funded'), nativeToScVal('DEL-500', { type: 'string' })],
        value: nativeToScVal({ amount: 250n, asset: 'XLM', funded_by: 'GFUNDER' }),
        inSuccessfulContractCall: true,
        pagingToken: 'evt-1',
      } as unknown as StellarRpc.Api.EventResponse;

      expect(validateSorobanEventPayload('escrow', 'escrow_funded', validEvent)).toMatchObject({
        deliveryId: 'DEL-500',
        amount: 250,
        asset: 'XLM',
      });

      const malformedEvent = {
        ...validEvent,
        id: 'evt-bad',
        value: xdr.ScVal.scvVoid(),
      } as unknown as StellarRpc.Api.EventResponse;

      expect(() => validateSorobanEventPayload('escrow', 'escrow_funded', malformedEvent)).toThrow(
        EventPayloadValidationError,
      );
    });
  });

  describe('EventPoller dispatch guard integration', () => {
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

    it('rejects malformed events before handler dispatch, marks EventLog failed, and advances checkpoint for valid events', async () => {
      await IndexerStatus.create({
        network: 'testnet',
        lastProcessedLedger: 200,
        lastProcessedAt: new Date(),
      });

      const badEvent = {
        id: 'evt-bad-201',
        type: 'contract',
        ledger: 201,
        ledgerClosedAt: '2026-11-24T00:00:00Z',
        contractId: 'CTEST',
        txHash: 'tx-bad-201',
        topic: [xdr.ScVal.scvSymbol('escrow_funded')],
        value: xdr.ScVal.scvVoid(),
        inSuccessfulContractCall: true,
        pagingToken: 'evt-bad-201',
      } as unknown as StellarRpc.Api.EventResponse;

      const goodEvent = {
        id: 'evt-good-202',
        type: 'contract',
        ledger: 202,
        ledgerClosedAt: '2026-11-24T00:00:00Z',
        contractId: 'CTEST',
        txHash: 'tx-good-202',
        topic: [xdr.ScVal.scvSymbol('escrow_funded'), nativeToScVal('DEL-202', { type: 'string' })],
        value: nativeToScVal({ amount: 150n, asset: 'XLM', funded_by: 'GFUNDER' }),
        inSuccessfulContractCall: true,
        pagingToken: 'evt-good-202',
      } as unknown as StellarRpc.Api.EventResponse;

      const events = [badEvent, goodEvent];
      const rpc = {
        getLatestLedger: jest.fn(async () => ({ sequence: 205 })),
        getEvents: jest.fn(async (req: SorobanGetEventsRequest) => {
          const start = req.cursor ? Number(req.cursor) : 0;
          const page = events.slice(start, start + (req.limit ?? 100));
          return { latestLedger: 205, events: page, cursor: String(start + page.length) };
        }),
      } as unknown as ISorobanRpcClient;

      const handle = jest.fn().mockResolvedValue(undefined);
      const poller = new EventPoller({
        rpc,
        network: 'testnet',
        contractId: 'CTEST',
        subscriptions: [{ eventType: 'escrow', topic: 'escrow_funded', handle }],
        intervalMs: 60_000,
        pageSize: 100,
      });

      const cycle = await poller.pollOnce();

      expect(cycle).toMatchObject({ fetched: 2, processed: 1, failed: 1, duplicates: 0 });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(goodEvent);

      const failedRow = await EventLog.findOne({ transactionHash: 'tx-bad-201' }).lean();
      expect(failedRow).toMatchObject({
        status: 'failed',
      });
      expect(failedRow?.errorMessage).toContain('Malformed escrow/escrow_funded event payload');
      expect(failedRow?.nextRetryAt).toBeInstanceOf(Date);

      const processedRow = await EventLog.findOne({ transactionHash: 'tx-good-202' }).lean();
      expect(processedRow?.status).toBe('processed');

      const checkpoint = await IndexerStatus.findOne({ network: 'testnet' }).lean();
      expect(checkpoint?.lastProcessedLedger).toBe(205);

      expect(logger.error).toHaveBeenCalledWith(
        '[EventPoller] Event payload validation failed — skipping handler dispatch',
        expect.objectContaining({
          eventType: 'escrow',
          topic: 'escrow_funded',
          transactionHash: 'tx-bad-201',
        }),
      );
    });
  });
});
