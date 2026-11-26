import { rpc as StellarRpc, scValToNative } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { DeliveryStatus } from '../models/Delivery';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EventFamily = 'escrow' | 'delivery' | 'dispute' | 'reputation';

export interface ValidationFieldIssue {
  field: string;
  message: string;
  code: string;
}

/**
 * Typed error raised when a decoded contract event payload fails Zod validation
 * before handler dispatch.
 */
export class EventPayloadValidationError extends Error {
  public readonly eventType: EventFamily;
  public readonly topic: string;
  public readonly issues: ValidationFieldIssue[];

  constructor(eventType: EventFamily, topic: string, issues: ValidationFieldIssue[]) {
    const summary = issues
      .map((issue) => `${issue.field || '<root>'}: ${issue.message}`)
      .join('; ');
    super(`Malformed ${eventType}/${topic} event payload: ${summary}`);
    this.name = 'EventPayloadValidationError';
    this.eventType = eventType;
    this.topic = topic;
    this.issues = issues;
    Object.setPrototypeOf(this, EventPayloadValidationError.prototype);
  }
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

const nonEmptyString = z.string().trim().min(1, 'must be a non-empty string');

const positiveFiniteAmount = z.preprocess((value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}, z.number().finite('must be a finite number').positive('must be greater than 0'));

const stroopAmountString = z.preprocess(
  (value: unknown): unknown => {
    if (typeof value === 'bigint' || typeof value === 'number') {
      return String(value);
    }
    return value;
  },
  z.string().trim().regex(/^\d+$/, 'must be a non-negative integer stroop string'),
);

const nonNegativeInt = z.preprocess(
  (value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  },
  z.number().int('must be an integer').min(0, 'must be >= 0'),
);

const nonNegativeNumber = z.preprocess(
  (value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  },
  z.number().finite('must be a finite number').min(0, 'must be >= 0'),
);

const deliveryStatusValues = Object.values(DeliveryStatus) as [DeliveryStatus, ...DeliveryStatus[]];

// ─── Escrow family schemas ─────────────────────────────────────────────────────

export const escrowFundedPayloadSchema = z.object({
  deliveryId: nonEmptyString,
  amount: positiveFiniteAmount,
  asset: nonEmptyString,
  assetIssuer: nonEmptyString.optional(),
  fundedBy: nonEmptyString.optional(),
});

export const escrowResolutionPayloadSchema = z.object({
  escrowId: nonEmptyString,
  amount: stroopAmountString,
  asset: nonEmptyString,
  recipient: nonEmptyString,
  transactionHash: nonEmptyString,
  ledger: nonNegativeInt,
  timestamp: nonNegativeNumber,
});

export type ValidatedEscrowFundedPayload = z.infer<typeof escrowFundedPayloadSchema>;
export type ValidatedEscrowResolutionPayload = z.infer<typeof escrowResolutionPayloadSchema>;

// ─── Delivery family schemas ───────────────────────────────────────────────────

export const deliveryCreatedPayloadSchema = z.object({
  delivery_id: nonEmptyString,
  contract_id: nonEmptyString,
});

export const deliveryStatusUpdatedPayloadSchema = z.object({
  delivery_id: nonEmptyString,
  status: z.enum(deliveryStatusValues),
});

export type ValidatedDeliveryCreatedPayload = z.infer<typeof deliveryCreatedPayloadSchema>;
export type ValidatedDeliveryStatusUpdatedPayload = z.infer<
  typeof deliveryStatusUpdatedPayloadSchema
>;

// ─── Dispute family schemas ────────────────────────────────────────────────────

export const disputeOpenedPayloadSchema = z.object({
  disputeId: nonEmptyString,
  deliveryId: nonEmptyString,
  openedBy: nonEmptyString.optional(),
  reason: z.string().optional(),
  ledgerSequence: nonNegativeInt,
});

export const disputeResolvedPayloadSchema = z.object({
  disputeId: nonEmptyString,
  resolution: z.string().optional(),
  ledgerSequence: nonNegativeInt,
});

export type ValidatedDisputeOpenedPayload = z.infer<typeof disputeOpenedPayloadSchema>;
export type ValidatedDisputeResolvedPayload = z.infer<typeof disputeResolvedPayloadSchema>;

// ─── Reputation family schemas ─────────────────────────────────────────────────

export const reputationPayloadSchema = z.object({
  driverAddress: nonEmptyString,
  points: positiveFiniteAmount,
  ledgerSequence: nonNegativeInt,
});

export type ValidatedReputationPayload = z.infer<typeof reputationPayloadSchema>;

// ─── Schema registry ───────────────────────────────────────────────────────────

export const eventPayloadSchemas: Record<EventFamily, Record<string, z.ZodTypeAny>> = {
  escrow: {
    escrow_funded: escrowFundedPayloadSchema,
    escrow_released: escrowResolutionPayloadSchema,
    escrow_refunded: escrowResolutionPayloadSchema,
  },
  delivery: {
    delivery_created: deliveryCreatedPayloadSchema,
    delivery_status_updated: deliveryStatusUpdatedPayloadSchema,
  },
  dispute: {
    dispute_opened: disputeOpenedPayloadSchema,
    dispute_resolved: disputeResolvedPayloadSchema,
  },
  reputation: {
    reputation_increased: reputationPayloadSchema,
    reputation_slashed: reputationPayloadSchema,
  },
};

const toFieldIssues = (error: z.ZodError): ValidationFieldIssue[] =>
  error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));

/**
 * Resolve the Zod schema for an event family and topic.
 * Returns `undefined` when no schema is registered for the given pair.
 */
export function getEventPayloadSchema(
  eventType: EventFamily,
  topic: string,
): z.ZodTypeAny | undefined {
  return eventPayloadSchemas[eventType]?.[topic];
}

/**
 * Validate a decoded contract event payload against the registered Zod schema
 * for `(eventType, topic)`.
 *
 * @throws {EventPayloadValidationError} when the schema is unknown or validation fails.
 */
export function validateEventPayload<T = Record<string, unknown>>(
  eventType: EventFamily,
  topic: string,
  payload: unknown,
): T {
  const schema = getEventPayloadSchema(eventType, topic);
  if (!schema) {
    throw new EventPayloadValidationError(eventType, topic, [
      {
        field: 'topic',
        message: `Unsupported topic '${topic}' for event family '${eventType}'`,
        code: 'custom',
      },
    ]);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new EventPayloadValidationError(eventType, topic, toFieldIssues(parsed.error));
  }

  return parsed.data as T;
}

/**
 * Extract the canonical payload object from a raw Soroban RPC `EventResponse`
 * so it can be validated against the family/topic Zod schema before dispatch.
 */
function extractSorobanEventPayload(
  eventType: EventFamily,
  topic: string,
  event: StellarRpc.Api.EventResponse,
): Record<string, unknown> {
  const rawValue = scValToNative(event.value) as unknown;
  const data =
    rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};

  const decodeTopicAt = (index: number): unknown => {
    const topicVal = event.topic?.[index];
    return topicVal ? (scValToNative(topicVal) as unknown) : undefined;
  };

  if (eventType === 'escrow') {
    if (topic === 'escrow_funded') {
      return {
        deliveryId: decodeTopicAt(1) ?? data.delivery_id ?? data.deliveryId,
        amount: data.amount,
        asset: data.asset,
        assetIssuer: data.asset_issuer ?? data.assetIssuer,
        fundedBy: data.funded_by ?? data.fundedBy,
      };
    }

    if (topic === 'escrow_released' || topic === 'escrow_refunded') {
      return {
        escrowId: decodeTopicAt(1) ?? data.escrow_id ?? data.escrowId,
        amount: data.amount,
        asset: data.asset,
        recipient: data.recipient,
        transactionHash: data.transaction_hash ?? data.transactionHash ?? event.txHash,
        ledger: data.ledger ?? event.ledger,
        timestamp: data.timestamp ?? 0,
      };
    }
  }

  if (eventType === 'delivery') {
    return {
      delivery_id: data.delivery_id ?? decodeTopicAt(1),
      contract_id: data.contract_id,
      status: data.status,
    };
  }

  if (eventType === 'dispute') {
    if (topic === 'dispute_opened') {
      return {
        disputeId: decodeTopicAt(1) ?? data.dispute_id ?? data.disputeId,
        deliveryId: decodeTopicAt(2) ?? data.delivery_id ?? data.deliveryId,
        openedBy: data.opened_by ?? data.openedBy,
        reason: data.reason,
        ledgerSequence: event.ledger,
      };
    }

    if (topic === 'dispute_resolved') {
      return {
        disputeId: decodeTopicAt(1) ?? data.dispute_id ?? data.disputeId,
        resolution: data.resolution,
        ledgerSequence: event.ledger,
      };
    }
  }

  if (eventType === 'reputation') {
    return {
      driverAddress: decodeTopicAt(1) ?? data.driver_address ?? data.driverAddress,
      points: data.points,
      ledgerSequence: event.ledger,
    };
  }

  return data;
}

/**
 * Decode a raw Soroban RPC event and validate its payload against the schema
 * registered for `(eventType, topic)`.
 *
 * @throws {EventPayloadValidationError} when XDR decoding or schema validation fails.
 */
export function validateSorobanEventPayload(
  eventType: EventFamily,
  topic: string,
  event: StellarRpc.Api.EventResponse,
): Record<string, unknown> {
  let payload: Record<string, unknown>;
  try {
    payload = extractSorobanEventPayload(eventType, topic, event);
  } catch (error) {
    throw new EventPayloadValidationError(eventType, topic, [
      {
        field: 'value',
        message: error instanceof Error ? error.message : String(error),
        code: 'custom',
      },
    ]);
  }

  return validateEventPayload<Record<string, unknown>>(eventType, topic, payload);
}
