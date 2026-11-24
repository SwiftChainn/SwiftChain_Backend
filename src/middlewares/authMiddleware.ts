/**
 * Backwards-compatible path for the canonical database-backed middleware.
 * The canonical implementation lives in `src/middleware/authenticate.ts`
 * (DB-backed, blocks suspended/banned users); this file exists only to keep
 * existing imports working during the migration.
 */
export { default, default as authMiddleware } from '../middleware/authenticate';
export type { AuthenticatedRequest } from '../middleware/auth';
