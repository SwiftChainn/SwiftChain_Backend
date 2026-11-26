import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import Delivery, { DeliveryStatus } from '../models/Delivery';
import auditService from '../services/auditService';
import { hashQrToken, verifyQrToken } from '../utils/qrToken';
import AppError from '../utils/AppError';
import { sendSuccess } from '../utils/responseWrapper';

export async function verifyHandoffQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const deliveryId = req.params.id;
  const device = String(req.headers['user-agent'] ?? '').slice(0, 512);
  const ip = req.ip?.slice(0, 64);

  let outcome: 'verified' | 'invalid' | 'expired' | 'reused' = 'invalid';
  try {
    let decoded;
    try {
      decoded = verifyQrToken(token);
    } catch (error) {
      outcome = error instanceof Error && error.message.includes('expired') ? 'expired' : 'invalid';
      await auditService.recordHandoffScan({ deliveryId, token: hashQrToken(token), outcome, device, ip });
      await auditService.flushHandoffScans();
      throw error;
    }

    if (decoded.deliveryId !== deliveryId) {
      await auditService.recordHandoffScan({ deliveryId, token: hashQrToken(token), outcome: 'invalid', device, ip });
      await auditService.flushHandoffScans();
      throw new AppError('QR token does not belong to this delivery', StatusCodes.BAD_REQUEST);
    }

    const delivery = await Delivery.findOneAndUpdate(
      {
        _id: deliveryId,
        status: DeliveryStatus.IN_PROGRESS,
        handoffTokenHash: hashQrToken(token),
        handoffTokenExpiresAt: { $gt: new Date() },
        handoffTokenUsedAt: { $exists: false },
      },
      { $set: { handoffTokenUsedAt: new Date() } },
      { new: true },
    ).lean();

    if (!delivery) {
      outcome = 'reused';
      await auditService.recordHandoffScan({ deliveryId, token: hashQrToken(token), outcome, device, ip });
      await auditService.flushHandoffScans();
      throw new AppError('QR token is expired or already used', StatusCodes.CONFLICT);
    }

    await auditService.recordHandoffScan({ deliveryId, token: hashQrToken(token), outcome: 'verified', device, ip });
    await auditService.flushHandoffScans();
    sendSuccess(res, { verified: true, deliveryId, expiresAt: decoded.expiresAt }, 'Handoff verified', StatusCodes.OK);
  } catch (error) {
    next(error);
  }
}
