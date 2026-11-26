import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { eventArchiveService } from '../services/eventArchiveService';
import { sendSuccess, sendError } from '../utils/responseWrapper';
import { buildPaginationMeta } from '../middlewares/queryMiddleware';
import logger from '../config/logger';

const runArchiveBodySchema = z.object({
  retentionDays: z.coerce.number().int().min(1).optional(),
  batchSize: z.coerce.number().int().min(1).max(10000).optional(),
  purge: z.boolean().optional(),
});

const archivedEventsQuerySchema = z.object({
  startLedger: z.coerce.number().int().min(0).optional(),
  endLedger: z.coerce.number().int().min(0).optional(),
  eventType: z.string().trim().min(1).optional(),
  contractId: z.string().trim().min(1).optional(),
  transactionHash: z.string().trim().min(1).optional(),
  includeHot: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export class EventArchiveController {
  /**
   * POST /api/v1/eventlog/archives/run
   * Trigger a cold-storage archiving batch for processed EventLog entries past retention.
   */
  public async runArchive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = runArchiveBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(
          res,
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          StatusCodes.BAD_REQUEST,
        );
        return;
      }

      const result = await eventArchiveService.archiveExpiredEvents(parsed.data);
      sendSuccess(res, result, 'Event archive batch completed', StatusCodes.OK);
    } catch (error) {
      logger.error('[EventArchiveController] runArchive error:', error);
      next(error);
    }
  }

  /**
   * GET /api/v1/eventlog/archives/manifests
   * List recorded cold-storage archive manifests (paginated).
   */
  public async listManifests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const result = await eventArchiveService.listManifests(page, limit);

      sendSuccess(
        res,
        {
          manifests: result.data,
          meta: buildPaginationMeta(result.total, result.page, result.limit),
        },
        'Archive manifests retrieved successfully',
        StatusCodes.OK,
      );
    } catch (error) {
      logger.error('[EventArchiveController] listManifests error:', error);
      next(error);
    }
  }

  /**
   * GET /api/v1/eventlog/archives/manifests/:id/verify
   * Verify SHA-256 checksum and event count integrity for an archive manifest.
   */
  public async verifyManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const verification = await eventArchiveService.verifyManifest(id);
      sendSuccess(res, verification, 'Archive manifest verification completed', StatusCodes.OK);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Archive manifest not found')) {
        sendError(res, error.message, StatusCodes.NOT_FOUND);
        return;
      }
      logger.error('[EventArchiveController] verifyManifest error:', error);
      next(error);
    }
  }

  /**
   * GET /api/v1/eventlog/archives/events
   * Retrieve archived events (and optionally merge hot EventLog entries) by ledger range / entity.
   */
  public async getArchivedEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = archivedEventsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          StatusCodes.BAD_REQUEST,
        );
        return;
      }

      const { startLedger, endLedger } = parsed.data;
      if (startLedger !== undefined && endLedger !== undefined && startLedger > endLedger) {
        sendError(
          res,
          'startLedger must be less than or equal to endLedger',
          StatusCodes.BAD_REQUEST,
        );
        return;
      }

      const events = await eventArchiveService.getArchivedEvents(parsed.data);
      sendSuccess(
        res,
        { events, count: events.length },
        'Archived events retrieved successfully',
        StatusCodes.OK,
      );
    } catch (error) {
      logger.error('[EventArchiveController] getArchivedEvents error:', error);
      next(error);
    }
  }
}

export const eventArchiveController = new EventArchiveController();
