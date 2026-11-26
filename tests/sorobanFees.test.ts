jest.mock('../src/config/stellar', () => ({
  stellarConfig: {
    baseFee: '100',
    sorobanFeeMaxStroops: 10_000,
    sorobanFeeSafetyMultiplier: 2,
    sorobanFeeMultipliers: {
      escrowLock: 3,
      contractCall: 2,
      contractRead: 1,
    },
  },
}));

import { stellarConfig } from '../src/config/stellar';
import { estimateTransactionFee } from '../src/services/sorobanFees';

describe('estimateTransactionFee', () => {
  it.each([
    ['escrow_lock', '600'],
    ['contract_call', '400'],
    ['contract_read', '200'],
  ] as const)('applies the configured default for %s', (operationKind, expected) => {
    expect(estimateTransactionFee(operationKind, {})).toBe(expected);
  });

  it('accounts for serialized payload size and accepts an empty payload', () => {
    expect(estimateTransactionFee('contract_read', {})).toBe('200');
    expect(estimateTransactionFee('contract_read', { args: 'x'.repeat(300) })).toBe('400');
  });

  it('uses configured operation overrides and the maximum bound', () => {
    stellarConfig.sorobanFeeMultipliers.escrowLock = 5;
    expect(estimateTransactionFee('escrow_lock', {})).toBe('1000');

    stellarConfig.sorobanFeeMaxStroops = 700;
    expect(estimateTransactionFee('escrow_lock', { args: 'x'.repeat(1_000) })).toBe('700');
  });

  it('rejects unsupported kinds and oversized payloads', () => {
    expect(() => estimateTransactionFee('unknown' as never, {})).toThrow(
      'Unsupported Soroban operation kind',
    );
    expect(() => estimateTransactionFee('contract_call', { args: 'x'.repeat(1_048_577) })).toThrow(
      'cannot exceed',
    );
  });

  it('rejects invalid fee configuration rather than returning an unsafe estimate', () => {
    stellarConfig.sorobanFeeMaxStroops = 50;
    expect(() => estimateTransactionFee('contract_read', {})).toThrow(
      'Soroban fee estimation configuration is invalid',
    );
  });
});
