import { stellarConfig } from '../config/stellar';

export type SorobanOperationKind = 'escrow_lock' | 'contract_call' | 'contract_read';

/** JSON data that describes the operation arguments being estimated. */
export type SorobanFeePayload = Readonly<Record<string, string | number | boolean | null>>;

const OPERATION_MULTIPLIERS: Record<
  SorobanOperationKind,
  keyof typeof stellarConfig.sorobanFeeMultipliers
> = {
  escrow_lock: 'escrowLock',
  contract_call: 'contractCall',
  contract_read: 'contractRead',
};
const DEFAULT_MULTIPLIERS: Record<SorobanOperationKind, number> = {
  escrow_lock: 3,
  contract_call: 2,
  contract_read: 1,
};

const MAX_PAYLOAD_BYTES = 1_048_576;
const PAYLOAD_SIZE_UNIT_BYTES = 256;

/**
 * Return a bounded initial fee estimate in stroops. Soroban RPC simulation in
 * `prepareTransaction` remains authoritative for the final resource fee.
 * Larger serialized arguments receive one additional base-fee unit per 256
 * bytes, with all multipliers and the final result capped by validated config.
 */
export function estimateTransactionFee(
  operationKind: SorobanOperationKind,
  payload: SorobanFeePayload,
): string {
  const multiplierKey = OPERATION_MULTIPLIERS[operationKind];
  if (!multiplierKey) {
    throw new Error(`Unsupported Soroban operation kind: ${String(operationKind)}`);
  }

  const baseFee = Number(stellarConfig.baseFee);
  const maxFee = stellarConfig.sorobanFeeMaxStroops ?? 1_000_000;
  const operationMultiplier =
    stellarConfig.sorobanFeeMultipliers?.[multiplierKey] ?? DEFAULT_MULTIPLIERS[operationKind];
  const safetyMultiplier = stellarConfig.sorobanFeeSafetyMultiplier ?? 2;
  if (
    !Number.isSafeInteger(baseFee) ||
    baseFee < 1 ||
    !Number.isSafeInteger(maxFee) ||
    maxFee < baseFee ||
    !Number.isFinite(operationMultiplier) ||
    operationMultiplier < 1 ||
    !Number.isFinite(safetyMultiplier) ||
    safetyMultiplier < 1
  ) {
    throw new Error('Soroban fee estimation configuration is invalid.');
  }

  let serializedPayload: string;
  try {
    serializedPayload = JSON.stringify(payload);
  } catch {
    throw new Error('Soroban fee payload must be JSON serializable.');
  }
  if (serializedPayload === undefined) {
    throw new Error('Soroban fee payload must be a JSON object.');
  }

  const payloadBytes = Buffer.byteLength(serializedPayload, 'utf8');
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`Soroban fee payload cannot exceed ${MAX_PAYLOAD_BYTES} bytes.`);
  }

  const payloadUnits = Math.max(1, Math.ceil(payloadBytes / PAYLOAD_SIZE_UNIT_BYTES));
  const estimate = Math.ceil(baseFee * operationMultiplier * safetyMultiplier * payloadUnits);
  return String(Math.min(maxFee, Math.max(baseFee, estimate)));
}
