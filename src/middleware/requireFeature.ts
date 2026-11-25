import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FeatureFlag, isEnabled } from '../config/flags';
import AppError from '../utils/AppError';

/**
 * Gate a route behind a feature flag.
 *
 * While the flag is off the route behaves as if it did not exist: the request
 * is answered with 404 and nothing downstream (validation, controller,
 * service) runs, so a disabled feature is a strict no-op.
 */
const requireFeature =
  (flag: FeatureFlag) =>
  (_req: Request, _res: Response, next: NextFunction): void => {
    if (!isEnabled(flag)) {
      next(new AppError('Not found', StatusCodes.NOT_FOUND));
      return;
    }
    next();
  };

export default requireFeature;
