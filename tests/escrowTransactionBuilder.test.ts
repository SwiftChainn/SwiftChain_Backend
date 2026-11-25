/**
 * Unit tests for EscrowTransactionBuilder: argument encoding, signing, sequence
 * handling, fee application and typed validation errors. The RPC layer is
 * injected, so no network or database is involved.
 */

import {
  Account,
  Address,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { stellarConfig } from '../src/config/stellar';
import {
  EscrowTransactionBuildError,
  EscrowTransactionBuilder,
  EscrowTransactionRpc,
} from '../src/services/escrowTransactionBuilder';
import AppError from '../src/utils/AppError';

const CONTRACT_ID = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/config/stellar', () => ({
  stellarConfig: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    network: 'testnet',
    timeoutMs: 10000,
    escrowContractId: 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K',
    escrowLockFunction: 'lock_escrow',
    escrowReleaseFunction: 'release_escrow',
    escrowRefundFunction: 'refund_escrow',
    baseFee: '100',
    transactionTimeoutSeconds: 300,
  },
  sorobanRpcClient: {},
  createSorobanRpcClient: jest.fn(),
}));

const payer = Keypair.random();
const recipient = Keypair.random();

interface StubRpc extends EscrowTransactionRpc {
  loadAccount: jest.Mock<Promise<Account>, [string]>;
  prepare: jest.Mock<Promise<Transaction>, [Transaction]>;
}

const createRpc = (sequence = '100'): StubRpc => ({
  loadAccount: jest.fn((address: string) => Promise.resolve(new Account(address, sequence))),
  // The real node returns the simulated transaction; echoing it keeps every
  // field under assertion intact.
  prepare: jest.fn((tx: Transaction) => Promise.resolve(tx)),
});

const decode = (
  envelopeXdr: string,
): { tx: Transaction; contractId: string; functionName: string; args: unknown[] } => {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.TESTNET) as Transaction;
  const op = tx.operations[0] as { type: string; func: xdr.HostFunction };
  expect(tx.operations).toHaveLength(1);
  expect(op.type).toBe('invokeHostFunction');
  const invocation = op.func.invokeContract();
  return {
    tx,
    contractId: Address.fromScAddress(invocation.contractAddress()).toString(),
    functionName: invocation.functionName().toString(),
    args: invocation.args().map((arg: xdr.ScVal) => scValToNative(arg)),
  };
};

const expectBuildError = async (
  promise: Promise<unknown>,
  code: EscrowTransactionBuildError['code'],
  statusCode: number,
): Promise<void> => {
  const error = await promise.then(
    () => {
      throw new Error('expected the build to fail');
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(EscrowTransactionBuildError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, statusCode });
};

afterEach(() => {
  stellarConfig.escrowContractId = CONTRACT_ID;
});

describe('EscrowTransactionBuilder — encoding', () => {
  it('encodes buildFund as (payer, reference, i128 stroops) against the lock function', async () => {
    const envelope = await new EscrowTransactionBuilder(createRpc()).buildFund({
      payerAddress: payer.publicKey(),
      escrowReference: '  DLV-1  ',
      amount: 15.99,
    });

    const decoded = decode(envelope.xdr);
    expect(decoded.contractId).toBe(CONTRACT_ID);
    expect(decoded.functionName).toBe('lock_escrow');
    expect(decoded.args).toEqual([payer.publicKey(), 'DLV-1', BigInt(159_900_000)]);
    expect(envelope).toMatchObject({
      action: 'fund',
      contractFunction: 'lock_escrow',
      sourceAccount: payer.publicKey(),
      stroops: BigInt(159_900_000),
      signed: false,
    });
  });

  it.each([
    ['buildRelease', 'release', 'release_escrow'],
    ['buildRefund', 'refund', 'refund_escrow'],
  ] as const)('encodes %s as (caller, reference) against %s', async (method, action, fn) => {
    const envelope = await new EscrowTransactionBuilder(createRpc())[method]({
      callerAddress: recipient.publicKey(),
      escrowReference: 'DLV-2',
    });

    const decoded = decode(envelope.xdr);
    expect(decoded.functionName).toBe(fn);
    expect(decoded.args).toEqual([recipient.publicKey(), 'DLV-2']);
    expect(envelope).toMatchObject({ action, contractFunction: fn });
  });

  it('applies the configured base fee and validity window before simulation', async () => {
    const rpc = createRpc();
    await new EscrowTransactionBuilder(rpc).buildRelease({
      callerAddress: recipient.publicKey(),
      escrowReference: 'DLV-3',
    });

    const built = rpc.prepare.mock.calls[0][0];
    expect(built.fee).toBe('100');
    expect(built.networkPassphrase).toBe(Networks.TESTNET);
    expect(Number(built.timeBounds?.maxTime)).toBeGreaterThan(0);
  });
});

describe('EscrowTransactionBuilder — signing', () => {
  it('signs the prepared envelope when the signer is the source account', async () => {
    const envelope = await new EscrowTransactionBuilder(createRpc()).buildRefund({
      callerAddress: payer.publicKey(),
      escrowReference: 'DLV-4',
      signer: payer,
    });

    const { tx } = decode(envelope.xdr);
    expect(envelope.signed).toBe(true);
    expect(tx.signatures).toHaveLength(1);
    expect(payer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  it('returns an unsigned envelope for a client wallet when no signer is given', async () => {
    const envelope = await new EscrowTransactionBuilder(createRpc()).buildFund({
      payerAddress: payer.publicKey(),
      escrowReference: 'DLV-5',
      amount: 1,
    });

    expect(envelope.signed).toBe(false);
    expect(decode(envelope.xdr).tx.signatures).toHaveLength(0);
  });

  it('rejects a signer that is not the source account before any RPC call', async () => {
    const rpc = createRpc();
    await expectBuildError(
      new EscrowTransactionBuilder(rpc).buildRelease({
        callerAddress: recipient.publicKey(),
        escrowReference: 'DLV-6',
        signer: payer,
      }),
      'WRONG_SIGNER',
      403,
    );
    expect(rpc.loadAccount).not.toHaveBeenCalled();
    expect(rpc.prepare).not.toHaveBeenCalled();
  });
});

describe('EscrowTransactionBuilder — sequencing', () => {
  it('uses the next sequence of the freshly loaded source account', async () => {
    const rpc = createRpc('41');
    const envelope = await new EscrowTransactionBuilder(rpc).buildFund({
      payerAddress: payer.publicKey(),
      escrowReference: 'DLV-7',
      amount: 2,
    });

    expect(rpc.loadAccount).toHaveBeenCalledWith(payer.publicKey());
    expect(envelope.sequence).toBe('42');
  });

  it('reloads the account on every build, so a rebuild after tx_bad_seq picks up the new sequence', async () => {
    const rpc = createRpc();
    rpc.loadAccount
      .mockResolvedValueOnce(new Account(payer.publicKey(), '10'))
      .mockResolvedValueOnce(new Account(payer.publicKey(), '15'));
    const builder = new EscrowTransactionBuilder(rpc);
    const input = { payerAddress: payer.publicKey(), escrowReference: 'DLV-8', amount: 3 };

    const first = await builder.buildFund(input);
    const rebuilt = await builder.buildFund(input);

    expect(rpc.loadAccount).toHaveBeenCalledTimes(2);
    expect(first.sequence).toBe('11');
    expect(rebuilt.sequence).toBe('16');
  });

  it('propagates RPC failures from the caller-supplied account loader unchanged', async () => {
    const rpc = createRpc();
    const failure = new AppError('Account not found', 404);
    rpc.loadAccount.mockRejectedValueOnce(failure);

    await expect(
      new EscrowTransactionBuilder(rpc).buildFund({
        payerAddress: payer.publicKey(),
        escrowReference: 'DLV-9',
        amount: 1,
      }),
    ).rejects.toBe(failure);
    expect(rpc.prepare).not.toHaveBeenCalled();
  });
});

describe('EscrowTransactionBuilder — validation errors', () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e12])(
    'rejects the amount %p with INVALID_AMOUNT',
    async (amount) => {
      await expectBuildError(
        new EscrowTransactionBuilder(createRpc()).buildFund({
          payerAddress: payer.publicKey(),
          escrowReference: 'DLV-10',
          amount,
        }),
        'INVALID_AMOUNT',
        422,
      );
    },
  );

  it('rejects a missing escrow contract with MISSING_CONTRACT', async () => {
    stellarConfig.escrowContractId = undefined;
    const rpc = createRpc();

    await expectBuildError(
      new EscrowTransactionBuilder(rpc).buildRefund({
        callerAddress: payer.publicKey(),
        escrowReference: 'DLV-11',
      }),
      'MISSING_CONTRACT',
      503,
    );
    expect(rpc.loadAccount).not.toHaveBeenCalled();
  });

  it('rejects a source that is not a Stellar account with INVALID_ADDRESS', async () => {
    await expectBuildError(
      new EscrowTransactionBuilder(createRpc()).buildRelease({
        callerAddress: CONTRACT_ID,
        escrowReference: 'DLV-12',
      }),
      'INVALID_ADDRESS',
      400,
    );
  });

  it('rejects a blank escrow reference with INVALID_REFERENCE', async () => {
    await expectBuildError(
      new EscrowTransactionBuilder(createRpc()).buildRelease({
        callerAddress: recipient.publicKey(),
        escrowReference: '   ',
      }),
      'INVALID_REFERENCE',
      422,
    );
  });
});
