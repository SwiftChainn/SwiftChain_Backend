import { Types } from 'mongoose';
import AuditLog from '../models/AuditLog';

export type HandoffAuditOutcome = 'verified' | 'invalid' | 'expired' | 'reused';

export interface HandoffScanInput {
  deliveryId?: string;
  token: string;
  outcome: HandoffAuditOutcome;
  device?: string;
  ip?: string;
  actorId?: string;
}

export class AuditService {
  private queue: Array<Record<string, unknown>> = [];

  async recordHandoffScan(input: HandoffScanInput): Promise<void> {
    const targetId = input.deliveryId && Types.ObjectId.isValid(input.deliveryId)
      ? new Types.ObjectId(input.deliveryId)
      : null;

    this.queue.push({
      action: 'handoff.scan',
      actor: input.actorId && Types.ObjectId.isValid(input.actorId)
        ? new Types.ObjectId(input.actorId)
        : null,
      targetType: 'Delivery',
      targetId,
      description: `Handoff scan ${input.outcome}`,
      meta: {
        tokenOutcome: input.outcome,
        tokenHash: input.token,
        device: input.device?.slice(0, 512) ?? null,
        ip: input.ip?.slice(0, 64) ?? null,
        timestamp: new Date().toISOString(),
      },
    });

    if (this.queue.length >= 50) await this.flushHandoffScans();
  }

  async flushHandoffScans(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 50);
    await AuditLog.insertMany(batch, { ordered: false });
  }

  async listHandoffScans(filters: {
    page: number;
    limit: number;
    outcome?: HandoffAuditOutcome;
    deliveryId?: string;
  }): Promise<{ items: unknown[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, filters.page);
    const limit = Math.min(100, Math.max(1, filters.limit));
    const query: Record<string, unknown> = { action: 'handoff.scan' };
    if (filters.outcome) query['meta.tokenOutcome'] = filters.outcome;
    if (filters.deliveryId && Types.ObjectId.isValid(filters.deliveryId)) {
      query.targetId = new Types.ObjectId(filters.deliveryId);
    }

    const [items, total] = await Promise.all([
      AuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(query),
    ]);

    return { items, total, page, limit };
  }

  async countRepeatedFailures(deliveryId: string, ip?: string): Promise<number> {
    const query: Record<string, unknown> = {
      action: 'handoff.scan',
      'meta.tokenOutcome': { $ne: 'verified' },
    };
    if (Types.ObjectId.isValid(deliveryId)) {
      query.targetId = new Types.ObjectId(deliveryId);
    }
    if (ip) query['meta.ip'] = ip;
    return AuditLog.countDocuments(query);
  }
}

export const auditService = new AuditService();
export default auditService;
