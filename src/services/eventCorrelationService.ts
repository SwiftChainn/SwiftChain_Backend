/**
 * Event correlation service (#334).
 *
 * Maps every ingested on-chain transaction / ledger event back to the off-chain
 * entity (delivery, escrow, dispute, reputation, milestone) it mutated, and
 * provides query APIs for both the event-log and admin explorer endpoints.
 */

import mongoose from 'mongoose';
import { rpc as StellarRpc, scValToNative } from '@stellar/stellar-sdk';
import EventCorrelation, {
  type CorrelatedEntityType,
  type IEventCorrelation,
} from '../models/EventCorrelation';
import EventLog, { type IEventLog } from '../models/EventLog';

export interface RecordCorrelationInput {
  contractId: string;
  transactionHash: string;
  ledgerSequence: number;
  eventType: CorrelatedEntityType;
  eventHash?: string | null;
  eventLogId?: mongoose.Types.ObjectId | string | null;
  topic?: string | null;
  entityType: CorrelatedEntityType;
  entityId: string;
  metadata?: Record<string, unknown> | null;
}

export interface CorrelatedEntityRef {
  entityType: CorrelatedEntityType;
  entityId: string;
  contractId: string;
  transactionHash: string;
  ledgerSequence: number;
  eventType: CorrelatedEntityType;
  eventHash?: string | null;
  topic?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TxCorrelationResult {
  transactionHash: string;
  entities: CorrelatedEntityRef[];
  events: IEventLog[];
}

export interface EntityEventsResult {
  entityType: CorrelatedEntityType;
  entityId: string;
  correlations: CorrelatedEntityRef[];
  events: IEventLog[];
}

export interface LedgerRangeCorrelationResult {
  startLedger: number;
  endLedger: number;
  entities: CorrelatedEntityRef[];
  events: IEventLog[];
}

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'delivery',
  'escrow',
  'dispute',
  'reputation',
  'milestone',
]);

export function isValidCorrelatedEntityType(value: string): value is CorrelatedEntityType {
  return VALID_ENTITY_TYPES.has(value);
}

/**
 * Best-effort extraction of `(entityType, entityId)` from a Soroban RPC event
 * across all SwiftChain contract event families.
 */
export function extractEntityFromRpcEvent(
  eventType: CorrelatedEntityType,
  event: StellarRpc.Api.EventResponse,
): { entityType: CorrelatedEntityType; entityId: string; topic?: string } | null {
  let topicName: string | undefined;
  let secondaryTopicId: string | undefined;

  if (Array.isArray(event.topic) && event.topic.length > 0) {
    try {
      const first = scValToNative(event.topic[0]);
      if (typeof first === 'string') topicName = first;
    } catch {
      // ignore non-native topic
    }

    if (event.topic.length > 1) {
      try {
        const second = scValToNative(event.topic[1]);
        if (typeof second === 'string' && second.trim().length > 0) {
          secondaryTopicId = second.trim();
        } else if (typeof second === 'number' || typeof second === 'bigint') {
          secondaryTopicId = String(second);
        }
      } catch {
        // ignore non-native topic
      }
    }
  }

  let payload: Record<string, unknown> | null = null;
  if (event.value) {
    try {
      const decoded = scValToNative(event.value);
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        payload = decoded as Record<string, unknown>;
      }
    } catch {
      // ignore non-map payload
    }
  }

  const pickString = (...keys: string[]): string | undefined => {
    if (!payload) return undefined;
    for (const key of keys) {
      const val = payload[key];
      if (typeof val === 'string' && val.trim().length > 0) return val.trim();
      if (typeof val === 'number' || typeof val === 'bigint') return String(val);
    }
    return undefined;
  };

  let entityId: string | undefined;
  switch (eventType) {
    case 'escrow':
      entityId =
        secondaryTopicId ?? pickString('escrow_id', 'escrowId', 'delivery_id', 'deliveryId');
      break;
    case 'delivery':
      entityId = secondaryTopicId ?? pickString('delivery_id', 'deliveryId', 'id');
      break;
    case 'dispute':
      entityId =
        secondaryTopicId ?? pickString('dispute_id', 'disputeId', 'delivery_id', 'deliveryId');
      break;
    case 'reputation':
      entityId =
        secondaryTopicId ?? pickString('driver_address', 'driverAddress', 'driverId', 'userId');
      break;
    case 'milestone':
      entityId =
        secondaryTopicId ?? pickString('milestone_id', 'milestoneId', 'delivery_id', 'deliveryId');
      break;
  }

  if (!entityId) return null;
  return { entityType: eventType, entityId, topic: topicName };
}

function toRef(doc: IEventCorrelation): CorrelatedEntityRef {
  return {
    entityType: doc.entityType,
    entityId: doc.entityId,
    contractId: doc.contractId,
    transactionHash: doc.transactionHash,
    ledgerSequence: doc.ledgerSequence,
    eventType: doc.eventType,
    eventHash: doc.eventHash ?? null,
    topic: doc.topic ?? null,
    metadata: doc.metadata ?? null,
  };
}

export class EventCorrelationService {
  /**
   * Idempotently record a mapping from an on-chain event to the off-chain entity
   * it mutated. Re-recording the same correlation updates metadata without
   * creating duplicates.
   */
  async recordCorrelation(input: RecordCorrelationInput): Promise<IEventCorrelation> {
    const filter = {
      contractId: input.contractId.trim(),
      transactionHash: input.transactionHash.trim(),
      ledgerSequence: input.ledgerSequence,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId.trim(),
    };

    const update = {
      $set: {
        ...filter,
        ...(input.eventHash !== undefined ? { eventHash: input.eventHash } : {}),
        ...(input.eventLogId !== undefined ? { eventLogId: input.eventLogId } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    };

    return EventCorrelation.findOneAndUpdate(filter, update, {
      new: true,
      upsert: true,
      runValidators: true,
    });
  }

  /**
   * Resolve a transaction hash to every off-chain entity it mutated and the
   * corresponding EventLog records. Returns empty arrays for unknown hashes.
   */
  async getEntitiesForTx(transactionHash: string): Promise<TxCorrelationResult> {
    const normalizedHash = transactionHash.trim();
    const [correlations, events] = await Promise.all([
      EventCorrelation.find({ transactionHash: normalizedHash }).sort({ ledgerSequence: 1 }),
      EventLog.find({ transactionHash: normalizedHash }).sort({ ledgerSequence: 1 }),
    ]);

    return {
      transactionHash: normalizedHash,
      entities: correlations.map(toRef),
      events,
    };
  }

  /**
   * Resolve a ledger sequence range (inclusive) to all affected off-chain
   * entities and EventLog entries, optionally filtered by eventType.
   */
  async getEntitiesForLedgerRange(
    startLedger: number,
    endLedger: number,
    eventType?: CorrelatedEntityType,
  ): Promise<LedgerRangeCorrelationResult> {
    const query: Record<string, unknown> = {
      ledgerSequence: { $gte: startLedger, $lte: endLedger },
    };
    if (eventType) {
      query.eventType = eventType;
    }

    const [correlations, events] = await Promise.all([
      EventCorrelation.find(query).sort({ ledgerSequence: 1 }),
      EventLog.find(query).sort({ ledgerSequence: 1 }),
    ]);

    return {
      startLedger,
      endLedger,
      entities: correlations.map(toRef),
      events,
    };
  }

  /**
   * Reverse lookup: given an off-chain `(entityType, entityId)`, return all
   * correlation records and the exact on-chain EventLog entries that touched it.
   */
  async getEventsForEntity(
    entityType: CorrelatedEntityType,
    entityId: string,
  ): Promise<EntityEventsResult> {
    const normalizedId = entityId.trim();
    const correlations = await EventCorrelation.find({
      entityType,
      entityId: normalizedId,
    }).sort({ ledgerSequence: 1 });

    if (correlations.length === 0) {
      return {
        entityType,
        entityId: normalizedId,
        correlations: [],
        events: [],
      };
    }

    const eventLogIds = correlations
      .map((c) => c.eventLogId)
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    const txHashes = Array.from(new Set(correlations.map((c) => c.transactionHash)));

    const eventQuery =
      eventLogIds.length > 0
        ? { $or: [{ _id: { $in: eventLogIds } }, { transactionHash: { $in: txHashes } }] }
        : { transactionHash: { $in: txHashes } };

    const events = await EventLog.find(eventQuery).sort({ ledgerSequence: 1 });

    return {
      entityType,
      entityId: normalizedId,
      correlations: correlations.map(toRef),
      events,
    };
  }
}

export const eventCorrelationService = new EventCorrelationService();
export default eventCorrelationService;
