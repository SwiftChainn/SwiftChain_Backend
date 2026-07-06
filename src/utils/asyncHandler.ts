import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express route handler to automatically catch errors
 * and forward them to the Express error handler via next().
 */
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express route handler so that any rejected promise is
 * forwarded to the global error-handling middleware via `next()`.
 */
const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };

export default asyncHandler;
