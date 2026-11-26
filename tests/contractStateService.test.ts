import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  ContractStateMalformedError,
  ContractStateNotFoundError,
  ContractStateReadError,
  ContractStateService,
  createContractDataLedgerKey,
  normalizeSorobanValue,
} from '../src/services/contractStateService';
import type { ISorobanRpcClient } from '../src/services/providers/sorobanRpcClient';

const CONTRACT_ID = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';
const KEY = createContractDataLedgerKey(CONTRACT_ID, xdr.ScVal.scvSymbol('state'));

const fakeClient = (value: unknown): ISorobanRpcClient =>
  ({
    getLedgerEntries: jest.fn().mockResolvedValue({
      entries: [
        {
          val: {
            contractData: () => ({ val: () => nativeToScVal(value) }),
          } as unknown as xdr.LedgerEntryData,
        },
      ],
      latestLedger: 100,
    }),
  }) as unknown as ISorobanRpcClient;

describe('ContractStateService', () => {
  it('reads and validates escrow state, converting i128 and duration values', async () => {
    const client = fakeClient({
      status: 'locked',
      balance: 123n,
      owner: new Address(CONTRACT_ID).toScVal(),
      updatedAt: 50n,
    });
    const service = new ContractStateService(client, 0);

    await expect(service.getEscrowState(KEY)).resolves.toMatchObject({
      status: 'locked',
      balance: 123,
      owner: CONTRACT_ID,
      updatedAt: 50,
    });
  });

  it('reads each supported state shape', async () => {
    await expect(
      new ContractStateService(
        fakeClient({ status: 'in_transit', etaSeconds: 900 }),
        0,
      ).getDeliveryState(KEY),
    ).resolves.toMatchObject({ status: 'in_transit', etaSeconds: 900 });
    await expect(
      new ContractStateService(fakeClient({ status: 'open', openedAt: 10n }), 0).getDisputeState(
        KEY,
      ),
    ).resolves.toMatchObject({ status: 'open', openedAt: 10 });
    await expect(
      new ContractStateService(
        fakeClient({ totalDeliveries: 90n, successfulDeliveries: 84n, averageRating: 5 }),
        0,
      ).getReputationState(KEY),
    ).resolves.toMatchObject({ totalDeliveries: 90, successfulDeliveries: 84, averageRating: 5 });
  });

  it('preserves integers outside the safe JavaScript number range and normalizes addresses', () => {
    expect(normalizeSorobanValue(9_007_199_254_740_992n)).toBe('9007199254740992');
    expect(normalizeSorobanValue(42n)).toBe(42);
    expect(normalizeSorobanValue(new Address(CONTRACT_ID))).toBe(CONTRACT_ID);
  });

  it('caches validated state for the configured TTL', async () => {
    const client = fakeClient({ status: 'locked', balance: '500' });
    const service = new ContractStateService(client, 5_000);

    await service.getEscrowState(KEY);
    await service.getEscrowState(KEY);

    expect(client.getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an absent entry from malformed state', async () => {
    const absentClient = {
      getLedgerEntries: jest.fn().mockResolvedValue({ entries: [], latestLedger: 100 }),
    };
    await expect(
      new ContractStateService(absentClient as unknown as ISorobanRpcClient, 0).getLedgerEntry(KEY),
    ).rejects.toBeInstanceOf(ContractStateNotFoundError);

    await expect(
      new ContractStateService(fakeClient({ status: 'locked' }), 0).getEscrowState(KEY),
    ).rejects.toBeInstanceOf(ContractStateMalformedError);
  });

  it('wraps RPC failures and rejects unsupported clients', async () => {
    const failingClient = { getLedgerEntries: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(
      new ContractStateService(failingClient as unknown as ISorobanRpcClient, 0).getLedgerEntry(
        KEY,
      ),
    ).rejects.toBeInstanceOf(ContractStateReadError);
    await expect(
      new ContractStateService({} as ISorobanRpcClient, 0).getLedgerEntry(KEY),
    ).rejects.toBeInstanceOf(ContractStateReadError);
  });
});
