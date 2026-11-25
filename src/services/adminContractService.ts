/**
 * adminContractService.ts
 *
 * Deploys and initializes Soroban contracts on test or standalone networks on
 * behalf of an admin, so staging and demo environments can be set up from the
 * API instead of the CLI.
 *
 * Safety rules:
 *   - Mainnet is refused outright, both from configuration and from the
 *     passphrase the RPC node itself reports, before anything is signed.
 *   - Transactions are signed by a dedicated deployer key
 *     (`ADMIN_CONTRACT_DEPLOYER_SECRET`); the operation is unavailable (503)
 *     without one.
 *   - Every operation is written to the ContractOperation audit log as
 *     `pending` before submission and moved to `succeeded` / `failed` after.
 *
 * Exposure is gated by the `adminContractOps` feature flag at the route.
 */

import { randomBytes } from 'crypto';
import {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  xdr,
} from '@stellar/stellar-sdk';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import env from '../config/env';
import logger from '../config/logger';
import { stellarConfig } from '../config/stellar';
import ContractOperation, {
  ContractOperationFields,
  ContractOperationType,
  IContractArg,
} from '../models/ContractOperation';
import AppError from '../utils/AppError';
import { sleep } from '../utils/rpcRetry';
import type { ContractArgInput } from '../validators/adminContractValidator';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DeployContractInput {
  /** Hex hash of WASM already uploaded to the network. */
  wasmHash: string;
  /** Optional hex salt; a random one is generated when omitted. */
  salt?: string;
  /** Id of the admin user requesting the deploy. */
  requestedBy: string;
}

export interface InitContractInput {
  contractId: string;
  method: string;
  args: ContractArgInput[];
  requestedBy: string;
}

/** The audit record of an operation, as stored. */
export type ContractOperationRecord = ContractOperationFields & { _id: Types.ObjectId };

/** Reads the deployer secret; injectable so tests need not touch the environment. */
export type DeployerSecretSource = () => string | undefined;

/** Outcome of a confirmed transaction. */
interface ConfirmedTransaction {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const POLL_INITIAL_DELAY_MS = 500;
const POLL_MAX_DELAY_MS = 5000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Thrown when a submitted transaction's outcome is not yet known. */
class UnconfirmedTransactionError extends AppError {
  constructor(public readonly transactionHash: string) {
    super(
      `Transaction ${transactionHash} did not reach a terminal state within the polling window. ` +
        'Verify it by hash before retrying.',
      StatusCodes.GATEWAY_TIMEOUT,
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class AdminContractService {
  constructor(
    private readonly client: ISorobanRpcClient = defaultSorobanRpcClient,
    private readonly deployerSecret: DeployerSecretSource = (): string | undefined =>
      env.ADMIN_CONTRACT_DEPLOYER_SECRET,
  ) {}

  /**
   * Deploy a contract instance from an uploaded WASM hash.
   *
   * @throws {AppError} 403 on mainnet; 503 without a deployer key;
   *                    502 when simulation, submission or execution fails;
   *                    504 when the outcome could not be confirmed.
   */
  async deploy(input: DeployContractInput): Promise<ContractOperationRecord> {
    const salt = input.salt ?? randomBytes(32).toString('hex');

    return this.execute(
      'deploy',
      { requestedBy: input.requestedBy, wasmHash: input.wasmHash.toLowerCase(), salt },
      (deployer) =>
        Operation.createCustomContract({
          address: new Address(deployer),
          wasmHash: Buffer.from(input.wasmHash, 'hex'),
          salt: Buffer.from(salt, 'hex'),
        }),
      (confirmed) =>
        confirmed.returnValue ? Address.fromScVal(confirmed.returnValue).toString() : undefined,
    );
  }

  /**
   * Invoke a contract's initialization function with typed arguments.
   *
   * @throws {AppError} same statuses as {@link deploy}.
   */
  async init(input: InitContractInput): Promise<ContractOperationRecord> {
    const args: IContractArg[] = input.args.map(({ type, value }) => ({ type, value }));

    return this.execute(
      'init',
      {
        requestedBy: input.requestedBy,
        contractId: input.contractId,
        method: input.method,
        args,
      },
      () => new Contract(input.contractId).call(input.method, ...input.args.map(toScVal)),
      () => input.contractId,
    );
  }

  // ── Execution pipeline ─────────────────────────────────────────────────────

  private async execute(
    operation: ContractOperationType,
    fields: Partial<
      Pick<ContractOperationFields, 'wasmHash' | 'salt' | 'contractId' | 'method' | 'args'>
    > & {
      requestedBy: string;
    },
    buildOperation: (deployer: string) => xdr.Operation,
    resolveContractId: (confirmed: ConfirmedTransaction) => string | undefined,
  ): Promise<ContractOperationRecord> {
    this.assertNotMainnet(stellarConfig.networkPassphrase);
    const signer = this.loadDeployer();
    await this.assertRemoteNotMainnet();

    const record = await ContractOperation.create({
      ...fields,
      operation,
      status: 'pending',
      network: stellarConfig.network,
      networkPassphrase: stellarConfig.networkPassphrase,
      sourceAccount: signer.publicKey(),
    });

    logger.info(
      `[AdminContractService] ${operation} started — id=${String(record._id)} ` +
        `network=${stellarConfig.network} source=${signer.publicKey()}`,
    );

    try {
      const transaction = await this.buildSigned(signer, buildOperation(signer.publicKey()));
      const confirmed = await this.submit(transaction);
      const contractId = resolveContractId(confirmed);

      logger.info(
        `[AdminContractService] ${operation} succeeded — id=${String(record._id)} ` +
          `tx=${confirmed.hash} ledger=${confirmed.ledger} contract=${contractId ?? 'n/a'}`,
      );

      return await this.update(record._id, {
        status: 'succeeded',
        transactionHash: confirmed.hash,
        ledger: confirmed.ledger,
        contractId,
      });
    } catch (error) {
      const message = errorMessage(error);

      if (error instanceof UnconfirmedTransactionError) {
        // The transaction may still land, so the record stays pending with its hash.
        await this.update(record._id, { transactionHash: error.transactionHash, error: message });
      } else {
        await this.update(record._id, { status: 'failed', error: message });
      }

      logger.error(
        `[AdminContractService] ${operation} failed — id=${String(record._id)} error="${message}"`,
      );
      throw error instanceof AppError
        ? error
        : new AppError(`Contract ${operation} failed: ${message}`, StatusCodes.BAD_GATEWAY);
    }
  }

  private async buildSigned(signer: Keypair, operation: xdr.Operation): Promise<Transaction> {
    const account = await this.client.getAccount(signer.publicKey()).catch((error: unknown) => {
      throw new AppError(
        `Unable to load deployer account ${signer.publicKey()}: ${errorMessage(error)}`,
        StatusCodes.BAD_GATEWAY,
      );
    });

    const transaction = new TransactionBuilder(account, {
      fee: stellarConfig.baseFee,
      networkPassphrase: stellarConfig.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(stellarConfig.transactionTimeoutSeconds)
      .build();

    const prepared = await this.client.prepareTransaction(transaction).catch((error: unknown) => {
      throw new AppError(
        `Soroban simulation failed: ${errorMessage(error)}`,
        StatusCodes.BAD_GATEWAY,
      );
    });
    prepared.sign(signer);
    return prepared;
  }

  /** Submit a signed transaction and wait for its terminal state. */
  private async submit(transaction: Transaction): Promise<ConfirmedTransaction> {
    const sent = await this.client.sendTransaction(transaction);
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      throw new AppError(
        `Transaction submission was rejected with status '${sent.status}'.`,
        StatusCodes.BAD_GATEWAY,
      );
    }

    const maxPolls = env.SOROBAN_RPC_MAX_RETRIES * 4;
    let delay = POLL_INITIAL_DELAY_MS;

    for (let poll = 1; poll <= maxPolls; poll++) {
      await sleep(delay);
      delay = Math.min(delay * 2, POLL_MAX_DELAY_MS);

      const result = await this.client.getTransaction(sent.hash).catch((error: unknown) => {
        logger.warn(
          `[AdminContractService] getTransaction poll ${poll}/${maxPolls} failed: ${errorMessage(
            error,
          )}`,
        );
        return null;
      });

      if (result?.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
        return { hash: sent.hash, ledger: result.ledger, returnValue: result.returnValue };
      }
      if (result?.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
        throw new AppError(
          `Transaction ${sent.hash} failed on-chain. Result XDR: ${result.resultXdr.toXDR(
            'base64',
          )}`,
          StatusCodes.BAD_GATEWAY,
        );
      }
    }

    throw new UnconfirmedTransactionError(sent.hash);
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  private assertNotMainnet(passphrase: string): void {
    if (stellarConfig.network === 'mainnet' || passphrase === Networks.PUBLIC) {
      throw new AppError(
        'Contract deploy/initialize is not permitted on mainnet.',
        StatusCodes.FORBIDDEN,
      );
    }
  }

  /** Refuse when the RPC node is on mainnet, whatever the local configuration says. */
  private async assertRemoteNotMainnet(): Promise<void> {
    const network = await this.client.getNetwork().catch((error: unknown) => {
      throw new AppError(
        `Unable to confirm the Soroban RPC network: ${errorMessage(error)}`,
        StatusCodes.BAD_GATEWAY,
      );
    });
    this.assertNotMainnet(network.passphrase);
  }

  private loadDeployer(): Keypair {
    const secret = this.deployerSecret();
    if (!secret) {
      throw new AppError(
        'Contract operations are not configured: ADMIN_CONTRACT_DEPLOYER_SECRET is not set.',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new AppError(
        'Contract operations are not configured: ADMIN_CONTRACT_DEPLOYER_SECRET is invalid.',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async update(
    id: Types.ObjectId,
    changes: Partial<ContractOperationFields>,
  ): Promise<ContractOperationRecord> {
    const updated = await ContractOperation.findByIdAndUpdate(id, changes, {
      new: true,
      runValidators: true,
    }).lean<ContractOperationRecord>();
    if (!updated) {
      throw new AppError(
        'Contract operation audit record disappeared.',
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
    return updated;
  }
}

/** Encode one validated argument as a Soroban value. */
export function toScVal(arg: ContractArgInput): xdr.ScVal {
  switch (arg.type) {
    case 'address':
      return new Address(arg.value).toScVal();
    case 'bool':
      return nativeToScVal(arg.value);
    case 'string':
    case 'symbol':
      return nativeToScVal(arg.value, { type: arg.type });
    // 32-bit integers are encoded from a number; wider types need a bigint.
    case 'u32':
    case 'i32':
      return nativeToScVal(Number(arg.value), { type: arg.type });
    default:
      return nativeToScVal(BigInt(arg.value), { type: arg.type });
  }
}

export const adminContractService = new AdminContractService();
