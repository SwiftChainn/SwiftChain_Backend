/**
 * Tests for POST /v1/admin/contracts/deploy and /v1/admin/contracts/init.
 *
 * Authentication, RBAC, validation, the feature flag and the audit log are all
 * real (users and ContractOperation records live in an in-memory MongoDB).
 * Only the Soroban RPC adapter is stubbed, so the suite runs offline.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Transaction,
  scValToNative,
  xdr,
  rpc as StellarRpc,
} from '@stellar/stellar-sdk';
import adminContractRoutes from '../src/routes/adminContractRoutes';
import errorHandler from '../src/middleware/errorHandler';
import User from '../src/models/User';
import ContractOperation from '../src/models/ContractOperation';
import { UserRole, UserStatus } from '../src/interfaces/IUser';
import * as flags from '../src/config/flags';
import env from '../src/config/env';
import { stellarConfig } from '../src/config/stellar';
import { defaultSorobanRpcClient } from '../src/services/providers/adapters';
import { toScVal } from '../src/services/adminContractService';

jest.mock('../src/config/database', () => ({ connectDatabase: jest.fn() }));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Confirmation polling waits between polls; skip the real delay.
jest.mock('../src/utils/rpcRetry', () => ({
  ...jest.requireActual('../src/utils/rpcRetry'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const JWT_SECRET = 'test-secret-key-16chars';
const WASM_HASH = 'ab'.repeat(32);
const DEPLOYED_CONTRACT = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';
const TX_HASH = 'f'.repeat(64);
const deployer = Keypair.random();
const tokenAddress = Keypair.random().publicKey();

const app = express();
app.use(express.json());
app.use('/v1/admin/contracts', adminContractRoutes);
app.use(errorHandler);

let mongoServer: MongoMemoryServer;
const original = {
  network: stellarConfig.network,
  passphrase: stellarConfig.networkPassphrase,
  secret: env.ADMIN_CONTRACT_DEPLOYER_SECRET,
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
}, 15_000);

let rpc: {
  getNetwork: jest.SpyInstance;
  getAccount: jest.SpyInstance;
  prepareTransaction: jest.SpyInstance;
  sendTransaction: jest.SpyInstance;
  getTransaction: jest.SpyInstance;
};

beforeEach(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  stellarConfig.network = 'testnet';
  stellarConfig.networkPassphrase = Networks.TESTNET;
  env.ADMIN_CONTRACT_DEPLOYER_SECRET = deployer.secret();
  jest.spyOn(flags, 'isEnabled').mockImplementation((flag) => flag === 'adminContractOps');

  rpc = {
    getNetwork: jest
      .spyOn(defaultSorobanRpcClient, 'getNetwork')
      .mockResolvedValue({ passphrase: Networks.TESTNET, protocolVersion: '22' }),
    getAccount: jest
      .spyOn(defaultSorobanRpcClient, 'getAccount')
      .mockImplementation((address: string) => Promise.resolve(new Account(address, '500'))),
    prepareTransaction: jest
      .spyOn(defaultSorobanRpcClient, 'prepareTransaction')
      .mockImplementation((tx) => Promise.resolve(tx as Transaction)),
    sendTransaction: jest.spyOn(defaultSorobanRpcClient, 'sendTransaction').mockResolvedValue({
      status: 'PENDING',
      hash: TX_HASH,
    } as unknown as StellarRpc.Api.SendTransactionResponse),
    getTransaction: jest.spyOn(defaultSorobanRpcClient, 'getTransaction').mockResolvedValue({
      status: StellarRpc.Api.GetTransactionStatus.SUCCESS,
      ledger: 777,
      returnValue: new Address(DEPLOYED_CONTRACT).toScVal(),
    } as unknown as StellarRpc.Api.GetTransactionResponse),
  };
});

afterEach(async () => {
  jest.restoreAllMocks();
  stellarConfig.network = original.network;
  stellarConfig.networkPassphrase = original.passphrase;
  env.ADMIN_CONTRACT_DEPLOYER_SECRET = original.secret;
  await Promise.all([User.deleteMany({}), ContractOperation.deleteMany({})]);
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

const tokenFor = async (role: UserRole): Promise<{ token: string; userId: string }> => {
  const user = await User.create({
    firstName: 'Test',
    lastName: 'User',
    email: `contracts-${role}-${Date.now()}-${Math.random()}@example.com`,
    password: 'Password123!',
    role,
    status: UserStatus.ACTIVE,
  });
  const userId = user._id.toString();
  return { token: jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' }), userId };
};

const post = async (
  path: 'deploy' | 'init',
  body: object,
  role: UserRole = UserRole.ADMIN,
): Promise<{ res: request.Response; userId: string }> => {
  const { token, userId } = await tokenFor(role);
  const res = await request(app)
    .post(`/v1/admin/contracts/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { res, userId };
};

const initBody = {
  contractId: DEPLOYED_CONTRACT,
  method: 'init',
  args: [
    { type: 'address', value: deployer.publicKey() },
    { type: 'address', value: tokenAddress },
    { type: 'u32', value: '250' },
  ],
};

/** The single host-function operation in the transaction that was submitted. */
const submittedHostFunction = (): { tx: Transaction; func: xdr.HostFunction } => {
  expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
  const tx = rpc.sendTransaction.mock.calls[0][0] as Transaction;
  expect(tx.operations).toHaveLength(1);
  return { tx, func: (tx.operations[0] as unknown as { func: xdr.HostFunction }).func };
};

const expectNothingExecuted = async (): Promise<void> => {
  expect(rpc.getAccount).not.toHaveBeenCalled();
  expect(rpc.sendTransaction).not.toHaveBeenCalled();
  expect(await ContractOperation.countDocuments({})).toBe(0);
};

// ─── Happy paths ───────────────────────────────────────────────────────────────

describe('POST /v1/admin/contracts/deploy', () => {
  it('deploys from the WASM hash, signs with the deployer and records the result', async () => {
    const { res, userId } = await post('deploy', { wasmHash: WASM_HASH });

    expect(res.status).toBe(201);
    expect(res.body.data.operation).toMatchObject({
      operation: 'deploy',
      status: 'succeeded',
      network: 'testnet',
      sourceAccount: deployer.publicKey(),
      wasmHash: WASM_HASH,
      contractId: DEPLOYED_CONTRACT,
      transactionHash: TX_HASH,
      ledger: 777,
    });

    const { tx, func } = submittedHostFunction();
    expect(deployer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    const created = func.createContractV2();
    expect(Buffer.from(created.executable().wasmHash()).toString('hex')).toBe(WASM_HASH);

    const record = await ContractOperation.findById(res.body.data.operation._id).lean();
    expect(record).toMatchObject({ status: 'succeeded', contractId: DEPLOYED_CONTRACT });
    expect(String(record?.requestedBy)).toBe(userId);
    expect(record?.salt).toMatch(/^[a-f\d]{64}$/);
  });

  it('uses the supplied salt so the contract address is reproducible', async () => {
    const salt = '01'.repeat(32);
    const { res } = await post('deploy', { wasmHash: WASM_HASH, salt });

    expect(res.status).toBe(201);
    const preimage = submittedHostFunction().func.createContractV2().contractIdPreimage();
    expect(Buffer.from(preimage.fromAddress().salt()).toString('hex')).toBe(salt);
  });
});

describe('POST /v1/admin/contracts/init', () => {
  it('invokes the method with typed arguments and records the result', async () => {
    const { res } = await post('init', initBody);

    expect(res.status).toBe(200);
    expect(res.body.data.operation).toMatchObject({
      operation: 'init',
      status: 'succeeded',
      contractId: DEPLOYED_CONTRACT,
      method: 'init',
      args: initBody.args,
      transactionHash: TX_HASH,
    });

    const invocation = submittedHostFunction().func.invokeContract();
    expect(Address.fromScAddress(invocation.contractAddress()).toString()).toBe(DEPLOYED_CONTRACT);
    expect(invocation.functionName().toString()).toBe('init');
    expect(invocation.args().map((arg) => scValToNative(arg))).toEqual([
      deployer.publicKey(),
      tokenAddress,
      250,
    ]);
  });
});

// ─── Mainnet rejection ─────────────────────────────────────────────────────────

describe('mainnet rejection', () => {
  it('refuses when the deployment is configured for mainnet', async () => {
    stellarConfig.network = 'mainnet';
    stellarConfig.networkPassphrase = Networks.PUBLIC;

    const { res } = await post('deploy', { wasmHash: WASM_HASH });

    expect(res.status).toBe(403);
    expect(rpc.getNetwork).not.toHaveBeenCalled();
    await expectNothingExecuted();
  });

  it('refuses when the RPC node reports the mainnet passphrase', async () => {
    rpc.getNetwork.mockResolvedValue({ passphrase: Networks.PUBLIC, protocolVersion: '22' });

    const { res } = await post('init', initBody);

    expect(res.status).toBe(403);
    await expectNothingExecuted();
  });
});

// ─── RBAC and feature flag ─────────────────────────────────────────────────────

describe('access control', () => {
  it.each([UserRole.USER, UserRole.DRIVER, UserRole.ENTERPRISE])(
    'denies a %s with 403',
    async (role) => {
      const { res } = await post('deploy', { wasmHash: WASM_HASH }, role);

      expect(res.status).toBe(403);
      await expectNothingExecuted();
    },
  );

  it('requires authentication', async () => {
    const res = await request(app).post('/v1/admin/contracts/init').send(initBody);

    expect(res.status).toBe(401);
    await expectNothingExecuted();
  });
});

describe('adminContractOps flag disabled', () => {
  it.each(['deploy', 'init'] as const)(
    'answers %s with 404 and does nothing, before validating the body',
    async (path) => {
      jest.spyOn(flags, 'isEnabled').mockReturnValue(false);

      const { res } = await post(path, {});

      expect(res.status).toBe(404);
      expect(rpc.getNetwork).not.toHaveBeenCalled();
      await expectNothingExecuted();
    },
  );
});

// ─── Validation ────────────────────────────────────────────────────────────────

describe('validation', () => {
  it.each([
    ['deploy', { wasmHash: 'not-hex' }, 'wasmHash'],
    ['deploy', { wasmHash: WASM_HASH, salt: 'abc' }, 'salt'],
    ['init', { ...initBody, contractId: deployer.publicKey() }, 'contractId'],
    ['init', { ...initBody, method: 'bad method!' }, 'method'],
    ['init', { ...initBody, args: [{ type: 'u32', value: '4294967296' }] }, 'args.0.value'],
    ['init', { ...initBody, args: [{ type: 'i128', value: '1.5' }] }, 'args.0.value'],
    ['init', { ...initBody, args: [{ type: 'address', value: 'GNOPE' }] }, 'args.0.value'],
    ['init', { ...initBody, args: [{ type: 'map', value: '{}' }] }, 'args.0.type'],
  ] as const)('rejects an invalid %s body (%s)', async (path, body, field) => {
    const { res } = await post(path, body);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ location: 'body', field })]),
    );
    await expectNothingExecuted();
  });
});

// ─── Failures are audited ──────────────────────────────────────────────────────

describe('failure handling', () => {
  it('returns 503 without a deployer key and records nothing', async () => {
    env.ADMIN_CONTRACT_DEPLOYER_SECRET = undefined;

    const { res } = await post('deploy', { wasmHash: WASM_HASH });

    expect(res.status).toBe(503);
    await expectNothingExecuted();
  });

  it('records an on-chain failure as failed and returns 502', async () => {
    rpc.getTransaction.mockResolvedValue({
      status: StellarRpc.Api.GetTransactionStatus.FAILED,
      ledger: 778,
      resultXdr: { toXDR: () => 'AAAA' },
    } as unknown as StellarRpc.Api.GetTransactionResponse);

    const { res } = await post('init', initBody);

    expect(res.status).toBe(502);
    const record = await ContractOperation.findOne({ operation: 'init' }).lean();
    expect(record).toMatchObject({ status: 'failed' });
    expect(record?.error).toContain('failed on-chain');
  });

  it('records a simulation failure as failed and never submits', async () => {
    rpc.prepareTransaction.mockRejectedValue(new Error('HostError: wasm not found'));

    const { res } = await post('deploy', { wasmHash: WASM_HASH });

    expect(res.status).toBe(502);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    const record = await ContractOperation.findOne({ operation: 'deploy' }).lean();
    expect(record?.status).toBe('failed');
    expect(record?.error).toContain('wasm not found');
  });

  it('keeps an unconfirmed submission pending with its hash and returns 504', async () => {
    rpc.getTransaction.mockResolvedValue({
      status: StellarRpc.Api.GetTransactionStatus.NOT_FOUND,
    } as unknown as StellarRpc.Api.GetTransactionResponse);

    const { res } = await post('deploy', { wasmHash: WASM_HASH });

    expect(res.status).toBe(504);
    const record = await ContractOperation.findOne({ operation: 'deploy' }).lean();
    expect(record).toMatchObject({ status: 'pending', transactionHash: TX_HASH });
  });
});

// ─── Argument encoding ─────────────────────────────────────────────────────────

describe('toScVal', () => {
  it.each([
    [{ type: 'address', value: DEPLOYED_CONTRACT }, 'scvAddress', DEPLOYED_CONTRACT],
    [{ type: 'string', value: 'hello' }, 'scvString', 'hello'],
    [{ type: 'symbol', value: 'init' }, 'scvSymbol', 'init'],
    [{ type: 'bool', value: true }, 'scvBool', true],
    [{ type: 'u32', value: '4294967295' }, 'scvU32', 4294967295],
    [{ type: 'i32', value: '-2147483648' }, 'scvI32', -2147483648],
    [{ type: 'u64', value: '18446744073709551615' }, 'scvU64', BigInt('18446744073709551615')],
    [{ type: 'i64', value: '-9' }, 'scvI64', BigInt(-9)],
    [
      { type: 'u128', value: '340282366920938463463374607431768211455' },
      'scvU128',
      BigInt('340282366920938463463374607431768211455'),
    ],
    [
      { type: 'i128', value: '-170141183460469231731687303715884105728' },
      'scvI128',
      BigInt('-170141183460469231731687303715884105728'),
    ],
  ] as const)('encodes %o as %s without losing precision', (arg, scvType, expected) => {
    const value = toScVal(arg);

    expect(value.switch().name).toBe(scvType);
    expect(scValToNative(value)).toEqual(expected);
  });
});
