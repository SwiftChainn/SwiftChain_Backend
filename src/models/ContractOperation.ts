import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Audit log of admin contract operations (deploy / initialize) executed by
 * the backend on test or standalone networks.
 *
 * A record is written as `pending` before the transaction is submitted and
 * then moved to `succeeded` or `failed`, so an operation interrupted
 * mid-submission still leaves a trace.
 */

export type ContractOperationType = 'deploy' | 'init';
export type ContractOperationStatus = 'pending' | 'succeeded' | 'failed';

/** Soroban argument types accepted by the initialize endpoint. */
export const CONTRACT_ARG_TYPES = [
  'address',
  'string',
  'symbol',
  'bool',
  'u32',
  'i32',
  'u64',
  'i64',
  'u128',
  'i128',
] as const;

export type ContractArgType = (typeof CONTRACT_ARG_TYPES)[number];

/** One typed contract argument, stored as submitted. */
export interface IContractArg {
  type: ContractArgType;
  value: string | boolean;
}

/** Stored fields of a contract operation. */
export interface ContractOperationFields {
  operation: ContractOperationType;
  status: ContractOperationStatus;
  /** Network alias the operation ran against (never `mainnet`). */
  network: string;
  networkPassphrase: string;
  /** Admin user who requested the operation. */
  requestedBy: Types.ObjectId;
  /** Account that signed and paid for the transaction. */
  sourceAccount: string;
  /** Deploy: hex hash of the uploaded contract WASM. */
  wasmHash?: string;
  /** Deploy: hex salt used to derive the contract address. */
  salt?: string;
  /** Deploy: the created contract; init: the contract initialized. */
  contractId?: string;
  /** Init: the contract function invoked. */
  method?: string;
  /** Init: the arguments passed to {@link method}. */
  args: IContractArg[];
  transactionHash?: string;
  ledger?: number;
  /** Failure reason when `status` is `failed`. */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IContractOperation extends ContractOperationFields, Document {}

const ContractArgSchema = new Schema<IContractArg>(
  {
    type: { type: String, enum: CONTRACT_ARG_TYPES, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const ContractOperationSchema = new Schema<IContractOperation>(
  {
    operation: { type: String, enum: ['deploy', 'init'], required: true },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      default: 'pending',
      required: true,
    },
    network: { type: String, required: true, trim: true },
    networkPassphrase: { type: String, required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sourceAccount: { type: String, required: true, trim: true },
    wasmHash: { type: String, trim: true },
    salt: { type: String, trim: true },
    contractId: { type: String, trim: true },
    method: { type: String, trim: true },
    args: { type: [ContractArgSchema], default: [] },
    transactionHash: { type: String, trim: true },
    ledger: { type: Number },
    error: { type: String },
  },
  { timestamps: true },
);

ContractOperationSchema.index({ operation: 1, createdAt: -1 });
ContractOperationSchema.index({ contractId: 1, createdAt: -1 });

export const ContractOperation = mongoose.model<IContractOperation>(
  'ContractOperation',
  ContractOperationSchema,
);

export default ContractOperation;
