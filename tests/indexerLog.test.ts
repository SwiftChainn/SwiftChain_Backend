/**
 * Unit tests for the structured indexer log helper and its use in
 * IndexerService. Logger calls are captured; no network is involved.
 */

import { rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import logger from '../src/config/logger';
import Delivery from '../src/models/Delivery';
import { IndexerService } from '../src/services/indexerService';
import type { ISorobanRpcClient } from '../src/services/providers/sorobanRpcClient';
import { entityIdFromEvent, indexerLog } from '../src/utils/indexerLog';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const CONTRACT_ID = 'CTESTDELIVERYCONTRACT';

const eventWithTopics = (topic: xdr.ScVal[]): StellarRpc.Api.EventResponse =>
  ({ topic }) as unknown as StellarRpc.Api.EventResponse;

/** Stub `Delivery.findOneAndUpdate(...).lean()` with the given outcome. */
const stubDeliveryUpdate = (lean: () => Promise<unknown>): void => {
  jest
    .spyOn(Delivery, 'findOneAndUpdate')
    .mockReturnValue({ lean } as unknown as ReturnType<typeof Delivery.findOneAndUpdate>);
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('indexerLog', () => {
  it('always writes the four context fields, filling the unknown ones with null', () => {
    indexerLog('debug', 'checkpoint', { ledgerSeq: 12, contractId: CONTRACT_ID });

    expect(logger.debug).toHaveBeenCalledWith('checkpoint', {
      ledgerSeq: 12,
      eventType: null,
      contractId: CONTRACT_ID,
      entityId: null,
    });
  });

  it('keeps extra metadata but never lets it overwrite the context fields', () => {
    indexerLog(
      'error',
      'failed',
      { ledgerSeq: 5, eventType: 'escrow' },
      {
        ledgerSeq: 999,
        transactionHash: 'tx-1',
      },
    );

    expect(logger.error).toHaveBeenCalledWith('failed', {
      ledgerSeq: 5,
      eventType: 'escrow',
      contractId: null,
      entityId: null,
      transactionHash: 'tx-1',
    });
  });
});

describe('entityIdFromEvent', () => {
  it('reads the entity key from the second topic', () => {
    const event = eventWithTopics([
      xdr.ScVal.scvSymbol('escrow_funded'),
      xdr.ScVal.scvU64(xdr.Uint64.fromString('42')),
    ]);
    expect(entityIdFromEvent(event)).toBe('42');
  });

  it('accepts a string entity key', () => {
    const event = eventWithTopics([xdr.ScVal.scvSymbol('t'), xdr.ScVal.scvString('DLV-1')]);
    expect(entityIdFromEvent(event)).toBe('DLV-1');
  });

  it('returns null when there is no entity topic or it is not a scalar', () => {
    expect(entityIdFromEvent(eventWithTopics([xdr.ScVal.scvSymbol('t')]))).toBeNull();
    expect(
      entityIdFromEvent(eventWithTopics([xdr.ScVal.scvSymbol('t'), xdr.ScVal.scvVec([])])),
    ).toBeNull();
  });
});

describe('IndexerService structured logs', () => {
  const service = new IndexerService({} as ISorobanRpcClient);
  const event = { contractId: CONTRACT_ID, deliveryId: 'delivery-1', newStatus: 'delivered' };
  const context = { eventType: 'delivery', contractId: CONTRACT_ID, entityId: 'delivery-1' };

  it('warns with the delivery context when the delivery is unknown', async () => {
    stubDeliveryUpdate(() => Promise.resolve(null));

    await service.processDeliveryStatusUpdated(event);

    expect(logger.warn).toHaveBeenCalledWith(
      '[IndexerService] Delivery not found for status update',
      expect.objectContaining({ ...context, ledgerSeq: null, newStatus: 'delivered' }),
    );
  });

  it('logs a successful status update at debug, not info', async () => {
    stubDeliveryUpdate(() => Promise.resolve({ _id: 'delivery-1' }));

    await service.processDeliveryStatusUpdated(event);

    expect(logger.debug).toHaveBeenCalledWith(
      '[IndexerService] Delivery status updated',
      expect.objectContaining(context),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs failures with the delivery context and rethrows', async () => {
    stubDeliveryUpdate(() => Promise.reject(new Error('write conflict')));

    await expect(service.processDeliveryStatusUpdated(event)).rejects.toThrow('write conflict');
    expect(logger.error).toHaveBeenCalledWith(
      '[IndexerService] Error processing delivery_status_updated event',
      expect.objectContaining({ ...context, error: 'write conflict' }),
    );
  });
});
