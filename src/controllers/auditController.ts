import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import auditService from '../services/auditService';
import { sendSuccess } from '../utils/responseWrapper';

export async function listHandoffAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const outcome = typeof req.query.outcome === 'string'
      ? req.query.outcome as 'verified' | 'invalid' | 'expired' | 'reused'
      : undefined;
    const deliveryId = typeof req.query.deliveryId === 'string' ? req.query.deliveryId : undefined;
    const ip = typeof req.query.ip === 'string' ? req.query.ip : undefined;

    const result = await auditService.listHandoffScans({ page, limit, outcome, deliveryId });
    const repeatedFailures = deliveryId
      ? await auditService.countRepeatedFailures(deliveryId, ip)
      : 0;

    sendSuccess(res, { ...result, repeatedFailures }, 'Handoff audit records retrieved', StatusCodes.OK);
  } catch (error) {
    next(error);
  }
}
