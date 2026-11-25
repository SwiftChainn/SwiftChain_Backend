import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';
import type { ContractArgType } from '../models/ContractOperation';

/** 32-byte value as 64 hex characters (WASM hash, salt). */
const hex32 = (field: string): z.ZodString =>
  z
    .string()
    .trim()
    .regex(/^[a-f\d]{64}$/i, `${field} must be 32 bytes encoded as 64 hex characters`);

type IntegerArgType = Extract<ContractArgType, 'u32' | 'i32' | 'u64' | 'i64' | 'u128' | 'i128'>;

/** Inclusive integer bounds for each numeric Soroban type. */
const INTEGER_BOUNDS: Record<IntegerArgType, [bigint, bigint]> = {
  u32: [BigInt(0), BigInt(2) ** BigInt(32) - BigInt(1)],
  i32: [-(BigInt(2) ** BigInt(31)), BigInt(2) ** BigInt(31) - BigInt(1)],
  u64: [BigInt(0), BigInt(2) ** BigInt(64) - BigInt(1)],
  i64: [-(BigInt(2) ** BigInt(63)), BigInt(2) ** BigInt(63) - BigInt(1)],
  u128: [BigInt(0), BigInt(2) ** BigInt(128) - BigInt(1)],
  i128: [-(BigInt(2) ** BigInt(127)), BigInt(2) ** BigInt(127) - BigInt(1)],
};

const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Integers are taken as decimal strings so 64- and 128-bit values survive
 * JSON without precision loss.
 */
const integerArg = <T extends IntegerArgType>(
  type: T,
): z.ZodObject<{ type: z.ZodLiteral<T>; value: z.ZodString }> =>
  z.object({
    type: z.literal(type),
    value: z
      .string()
      .trim()
      .regex(INTEGER_PATTERN, `${type} value must be a decimal integer string`)
      .refine((value) => {
        // Zod still runs refinements after a failed regex; that case is already reported.
        if (!INTEGER_PATTERN.test(value)) return true;
        const [min, max] = INTEGER_BOUNDS[type];
        const parsed = BigInt(value);
        return parsed >= min && parsed <= max;
      }, `value is out of range for ${type}`),
  });

export const contractArgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('address'),
    value: z
      .string()
      .trim()
      .refine(
        (value) => StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value),
        'address value must be a Stellar account (G...) or contract (C...) address',
      ),
  }),
  z.object({ type: z.literal('string'), value: z.string().max(1024) }),
  z.object({
    type: z.literal('symbol'),
    value: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,32}$/, 'symbol value must be 1-32 characters of [A-Za-z0-9_]'),
  }),
  z.object({ type: z.literal('bool'), value: z.boolean() }),
  integerArg('u32'),
  integerArg('i32'),
  integerArg('u64'),
  integerArg('i64'),
  integerArg('u128'),
  integerArg('i128'),
]);

export type ContractArgInput = z.infer<typeof contractArgSchema>;

export const deployContractSchema = z.object({
  wasmHash: hex32('wasmHash'),
  /** Optional; a random salt is generated when omitted. */
  salt: hex32('salt').optional(),
});

export type DeployContractBody = z.infer<typeof deployContractSchema>;

export const initContractSchema = z.object({
  contractId: z
    .string()
    .trim()
    .refine((value) => StrKey.isValidContract(value), 'contractId must be a contract id (C...)'),
  method: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,32}$/, 'method must be a contract function name'),
  args: z.array(contractArgSchema).max(20).default([]),
});

export type InitContractBody = z.infer<typeof initContractSchema>;
