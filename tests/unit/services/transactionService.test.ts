/**
 * Unit tests for EscrowTransactionBuilder & TransactionService (#333).
 *
 * Uses real Stellar SDK keypairs, Asset/Operation encoding, Ed25519 signature
 * verification, and sequence-number retry handling — with zero network calls.
 */

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc as StellarRpc,
} from '@stellar/stellar-sdk';
import {
  EscrowTransactionBuilder,
  TransactionService,
} from '../../../src/services/transactionService';
import { deliveryService } from '../../../src/services/delivery.service';
import { DeliveryStatus } from '../../../src/models/Delivery';
import { stellarConfig } from '../../../src/config/stellar';

jest.mock('../../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const PAYER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const ESCROW_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const DRIVER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const ISSUER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const COSIGNER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
const WRONG_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));

const CONTRACT_ID = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';

describe('EscrowTransactionBuilder (#333)', () => {
  const builder = new EscrowTransactionBuilder({
    networkPassphrase: Networks.TESTNET,
    baseFee: '100',
    timeoutSeconds: 300,
  });

  describe('buildFund / buildRelease / buildRefund operation encoding', () => {
    it('builds buildFund with native XLM asset and exact stroops amount', () => {
      const tx = builder.buildFund({
        sourceAccount: PAYER_KP.publicKey(),
        sequence: '100',
        destination: ESCROW_KP.publicKey(),
        amountStroops: 250_000_000n, // 25 XLM
      });

      expect(tx.source).toBe(PAYER_KP.publicKey());
      expect(tx.sequence).toBe('101'); // Stellar increments account sequence by 1
      expect(tx.operations).toHaveLength(1);

      const op = tx.operations[0] as Operation.Payment;
      expect(op.type).toBe('payment');
      expect(op.destination).toBe(ESCROW_KP.publicKey());
      expect(op.asset.isNative()).toBe(true);
      expect(op.amount).toBe('25.0000000');
      expect(tx.memo.value?.toString()).toBe('escrow_fund');
    });

    it('builds buildFund with an issued asset (USDC) and exact stroops', () => {
      const tx = builder.buildFund({
        sourceAccount: PAYER_KP.publicKey(),
        sequence: '500',
        destination: ESCROW_KP.publicKey(),
        amountStroops: '123456789', // 12.3456789 USDC
        asset: { code: 'USDC', issuer: ISSUER_KP.publicKey() },
      });

      const op = tx.operations[0] as Operation.Payment;
      expect(op.type).toBe('payment');
      expect(op.destination).toBe(ESCROW_KP.publicKey());
      expect(op.asset).toEqual(new Asset('USDC', ISSUER_KP.publicKey()));
      expect(op.amount).toBe('12.3456789');
    });

    it('builds buildRelease to driver for native and issued assets', () => {
      const nativeTx = builder.buildRelease({
        sourceAccount: ESCROW_KP.publicKey(),
        sequence: '10',
        destination: DRIVER_KP.publicKey(),
        amountStroops: 15_500_000, // 1.55 XLM
      });
      const nativeOp = nativeTx.operations[0] as Operation.Payment;
      expect(nativeOp.type).toBe('payment');
      expect(nativeOp.destination).toBe(DRIVER_KP.publicKey());
      expect(nativeOp.asset.isNative()).toBe(true);
      expect(nativeOp.amount).toBe('1.5500000');
      expect(nativeTx.memo.value?.toString()).toBe('escrow_release');

      const issuedTx = builder.buildRelease({
        sourceAccount: ESCROW_KP.publicKey(),
        sequence: '11',
        destination: DRIVER_KP.publicKey(),
        amountStroops: 50_000_000n,
        asset: { code: 'USDC', issuer: ISSUER_KP.publicKey() },
      });
      const issuedOp = issuedTx.operations[0] as Operation.Payment;
      expect(issuedOp.asset).toEqual(new Asset('USDC', ISSUER_KP.publicKey()));
      expect(issuedOp.amount).toBe('5.0000000');
    });

    it('builds buildRefund back to payer for native and issued assets', () => {
      const tx = builder.buildRefund({
        sourceAccount: ESCROW_KP.publicKey(),
        sequence: '42',
        destination: PAYER_KP.publicKey(),
        amountStroops: 100_000_000n,
        asset: { code: 'USDC', issuer: ISSUER_KP.publicKey() },
        memo: 'refund-order-42',
      });

      const op = tx.operations[0] as Operation.Payment;
      expect(op.type).toBe('payment');
      expect(op.destination).toBe(PAYER_KP.publicKey());
      expect(op.asset).toEqual(new Asset('USDC', ISSUER_KP.publicKey()));
      expect(op.amount).toBe('10.0000000');
      expect(tx.memo.value?.toString()).toBe('refund-order-42');
    });
  });

  describe('signature assembly and verification', () => {
    it('signs with single and multiple signers and verifies against public keys', () => {
      const tx = builder.buildRelease({
        sourceAccount: ESCROW_KP.publicKey(),
        sequence: '200',
        destination: DRIVER_KP.publicKey(),
        amountStroops: 10_000_000n,
      });

      builder.signTransaction(tx, [ESCROW_KP, COSIGNER_KP]);
      expect(tx.signatures).toHaveLength(2);

      // Re-parse from XDR to prove envelope round-trip verification
      const roundTripped = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as Transaction;

      expect(builder.verifySignature(roundTripped, ESCROW_KP.publicKey())).toBe(true);
      expect(builder.verifySignature(roundTripped, COSIGNER_KP.publicKey())).toBe(true);
      expect(builder.verifySignature(roundTripped, WRONG_KP.publicKey())).toBe(false);
    });

    it('rejects empty signers, watch-only keypair, or invalid signer public key', () => {
      const tx = builder.buildFund({
        sourceAccount: PAYER_KP.publicKey(),
        sequence: '1',
        destination: ESCROW_KP.publicKey(),
        amountStroops: 10_000_000n,
      });

      expect(() => builder.signTransaction(tx, [])).toThrow(/at least one signer/i);

      const watchOnly = Keypair.fromPublicKey(PAYER_KP.publicKey());
      expect(() => builder.signTransaction(tx, [watchOnly])).toThrow(/invalid signer/i);
      expect(() => builder.verifySignature(tx, 'NOT_A_KEY')).toThrow(/invalid signer public key/i);
    });
  });

  describe('sequence handling and tx_bad_seq retry', () => {
    it('applies the given sequence number on first attempt without retry', async () => {
      const seenSequences: string[] = [];
      const fetchFreshSequence = jest.fn();

      const outcome = await builder.submitWithSequenceRetry({
        initialSequence: '1000',
        build: (seq) =>
          builder.buildFund({
            sourceAccount: PAYER_KP.publicKey(),
            sequence: seq,
            destination: ESCROW_KP.publicKey(),
            amountStroops: 10_000_000n,
          }),
        submit: async (tx) => {
          seenSequences.push(tx.sequence);
          return { hash: 'tx-ok-1' };
        },
        fetchFreshSequence,
      });

      expect(outcome).toEqual({
        result: { hash: 'tx-ok-1' },
        attempts: 1,
        finalSequence: '1000',
      });
      expect(seenSequences).toEqual(['1001']);
      expect(fetchFreshSequence).not.toHaveBeenCalled();
    });

    it('rebuilds with a fresh sequence and succeeds after tx_bad_seq', async () => {
      const submittedSequences: string[] = [];
      const fetchFreshSequence = jest.fn().mockResolvedValueOnce('1050');

      const outcome = await builder.submitWithSequenceRetry({
        initialSequence: '1000',
        build: (seq) =>
          builder.buildRelease({
            sourceAccount: ESCROW_KP.publicKey(),
            sequence: seq,
            destination: DRIVER_KP.publicKey(),
            amountStroops: 20_000_000n,
          }),
        submit: async (tx) => {
          submittedSequences.push(tx.sequence);
          if (submittedSequences.length === 1) {
            throw Object.assign(new Error('Transaction failed: tx_bad_seq'), {
              resultCodes: { transaction: 'tx_bad_seq' },
            });
          }
          return { hash: 'tx-ok-after-retry' };
        },
        fetchFreshSequence,
      });

      expect(outcome).toEqual({
        result: { hash: 'tx-ok-after-retry' },
        attempts: 2,
        finalSequence: '1050',
      });
      expect(submittedSequences).toEqual(['1001', '1051']);
      expect(fetchFreshSequence).toHaveBeenCalledTimes(1);
    });

    it('propagates non-sequence errors immediately without retrying', async () => {
      const fetchFreshSequence = jest.fn();
      await expect(
        builder.submitWithSequenceRetry({
          initialSequence: '10',
          build: (seq) =>
            builder.buildRefund({
              sourceAccount: ESCROW_KP.publicKey(),
              sequence: seq,
              destination: PAYER_KP.publicKey(),
              amountStroops: 10_000_000n,
            }),
          submit: async () => {
            throw new Error('tx_insufficient_balance');
          },
          fetchFreshSequence,
        }),
      ).rejects.toThrow('tx_insufficient_balance');
      expect(fetchFreshSequence).not.toHaveBeenCalled();
    });
  });

  describe('validation failures', () => {
    it('rejects invalid source/destination addresses, sequence, and issued asset issuer', () => {
      expect(() =>
        builder.buildFund({
          sourceAccount: 'BAD_KEY',
          sequence: '1',
          destination: ESCROW_KP.publicKey(),
          amountStroops: 10_000_000n,
        }),
      ).toThrow(/invalid source/i);

      expect(() =>
        builder.buildFund({
          sourceAccount: PAYER_KP.publicKey(),
          sequence: '1',
          destination: 'BAD_DEST',
          amountStroops: 10_000_000n,
        }),
      ).toThrow(/invalid destination/i);

      expect(() =>
        builder.buildFund({
          sourceAccount: PAYER_KP.publicKey(),
          sequence: 'abc',
          destination: ESCROW_KP.publicKey(),
          amountStroops: 10_000_000n,
        }),
      ).toThrow(/invalid sequence/i);

      expect(() =>
        builder.buildFund({
          sourceAccount: PAYER_KP.publicKey(),
          sequence: '1',
          destination: ESCROW_KP.publicKey(),
          amountStroops: 10_000_000n,
          asset: { code: 'USDC', issuer: 'INVALID' },
        }),
      ).toThrow(/valid Stellar issuer/i);
    });

    it('rejects zero, negative, and non-integer amounts', () => {
      for (const badAmount of [0n, -5n, 0, -10, 1.5, '0', '-100', 'not-a-number']) {
        expect(() =>
          builder.buildFund({
            sourceAccount: PAYER_KP.publicKey(),
            sequence: '1',
            destination: ESCROW_KP.publicKey(),
            amountStroops: badAmount,
          }),
        ).toThrow();
      }
    });

    it('rejects mismatched network passphrase on build, sign, and verify', () => {
      expect(() =>
        builder.buildFund({
          sourceAccount: PAYER_KP.publicKey(),
          sequence: '1',
          destination: ESCROW_KP.publicKey(),
          amountStroops: 10_000_000n,
          networkPassphrase: Networks.PUBLIC,
        }),
      ).toThrow(/mismatched network passphrase/i);

      const mainnetBuilder = new EscrowTransactionBuilder({ networkPassphrase: Networks.PUBLIC });
      const mainnetTx = mainnetBuilder.buildFund({
        sourceAccount: PAYER_KP.publicKey(),
        sequence: '1',
        destination: ESCROW_KP.publicKey(),
        amountStroops: 10_000_000n,
      });

      expect(() => builder.signTransaction(mainnetTx, [PAYER_KP])).toThrow(
        /network passphrase mismatch/i,
      );
      expect(() => builder.verifySignature(mainnetTx, PAYER_KP.publicKey())).toThrow(
        /network passphrase mismatch/i,
      );
    });
  });
});

describe('TransactionService.buildEscrowLockXdr (unit coverage)', () => {
  const originalContractId = stellarConfig.escrowContractId;

  afterEach(() => {
    stellarConfig.escrowContractId = originalContractId;
    jest.restoreAllMocks();
  });

  it('builds an unsigned escrow-lock XDR and handles RPC / validation errors', async () => {
    stellarConfig.escrowContractId = CONTRACT_ID;
    const mockDelivery = {
      _id: '507f1f77bcf86cd799439011',
      deliveryId: 'DLV-UNIT-1',
      trackingNumber: 'TRK-UNIT-1',
      status: DeliveryStatus.ASSIGNED,
      escrowAmount: 10,
      escrowAsset: { code: 'XLM' },
    };

    jest.spyOn(deliveryService, 'getById').mockResolvedValue(mockDelivery as never);

    const fakeClient = {
      getAccount: jest.fn().mockResolvedValue(new Account(PAYER_KP.publicKey(), '100')),
      prepareTransaction: jest.fn().mockImplementation((tx: Transaction) => Promise.resolve(tx)),
    };

    const service = new TransactionService(fakeClient as unknown as StellarRpc.Server);
    const result = await service.buildEscrowLockXdr({
      deliveryId: '507f1f77bcf86cd799439011',
      payerAddress: PAYER_KP.publicKey(),
    });

    expect(result.xdr).toBeTruthy();
    expect(result.contractId).toBe(CONTRACT_ID);
    expect(result.amount.stroops).toBe('100000000');

    // Non-lockable status -> 409
    jest
      .spyOn(deliveryService, 'getById')
      .mockResolvedValue({ ...mockDelivery, status: DeliveryStatus.COMPLETED } as never);
    await expect(
      service.buildEscrowLockXdr({
        deliveryId: '507f1f77bcf86cd799439011',
        payerAddress: PAYER_KP.publicKey(),
      }),
    ).rejects.toThrow(/cannot be locked/i);

    // Invalid escrow amount -> 422
    jest
      .spyOn(deliveryService, 'getById')
      .mockResolvedValue({ ...mockDelivery, escrowAmount: 0 } as never);
    await expect(
      service.buildEscrowLockXdr({
        deliveryId: '507f1f77bcf86cd799439011',
        payerAddress: PAYER_KP.publicKey(),
      }),
    ).rejects.toThrow(/positive escrow amount/i);

    // Account 404 -> 404
    jest.spyOn(deliveryService, 'getById').mockResolvedValue(mockDelivery as never);
    fakeClient.getAccount.mockRejectedValueOnce({ code: 404, message: 'Account not found' });
    await expect(
      service.buildEscrowLockXdr({
        deliveryId: '507f1f77bcf86cd799439011',
        payerAddress: PAYER_KP.publicKey(),
      }),
    ).rejects.toThrow(/does not exist/i);

    // Prepare failure -> 502
    fakeClient.getAccount.mockResolvedValueOnce(new Account(PAYER_KP.publicKey(), '100'));
    fakeClient.prepareTransaction.mockRejectedValueOnce(new Error('simulation reverted'));
    await expect(
      service.buildEscrowLockXdr({
        deliveryId: '507f1f77bcf86cd799439011',
        payerAddress: PAYER_KP.publicKey(),
      }),
    ).rejects.toThrow(/simulation failed/i);

    // Missing contract id -> 503
    stellarConfig.escrowContractId = '';
    await expect(
      service.buildEscrowLockXdr({
        deliveryId: '507f1f77bcf86cd799439011',
        payerAddress: PAYER_KP.publicKey(),
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
