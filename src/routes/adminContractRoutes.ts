import { Router } from 'express';
import authenticate from '../middleware/authenticate';
import requireRole from '../middleware/requireRole';
import requireFeature from '../middleware/requireFeature';
import validate from '../middleware/validate';
import { deployContract, initContract } from '../controllers/adminContractController';
import { UserRole } from '../interfaces/IUser';
import { deployContractSchema, initContractSchema } from '../validators/adminContractValidator';

const router = Router();

// Admin only, and a strict no-op (404) unless the adminContractOps flag is on.
router.use(authenticate);
router.use(requireRole(UserRole.ADMIN));
router.use(requireFeature('adminContractOps'));

/**
 * @openapi
 * /v1/admin/contracts/deploy:
 *   post:
 *     tags: [Admin]
 *     summary: Deploy a contract on a test or standalone network
 *     description: >
 *       Admin-only and gated by the `adminContractOps` feature flag. Deploys a
 *       contract instance from WASM already uploaded to the network, signed by
 *       the configured deployer account. Mainnet is always refused. The
 *       operation is recorded in the contract-operations audit log.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [wasmHash]
 *             properties:
 *               wasmHash: { type: string, pattern: '^[a-fA-F0-9]{64}$' }
 *               salt: { type: string, pattern: '^[a-fA-F0-9]{64}$' }
 *     responses:
 *       201: { description: Contract deployed; returns the audit record }
 *       400: { description: Validation failed }
 *       401: { description: Missing or invalid token }
 *       403: { description: Caller is not an admin, or the network is mainnet }
 *       404: { description: Feature disabled }
 *       502: { description: Simulation, submission or execution failed }
 *       503: { description: Deployer account not configured }
 *       504: { description: Submitted but not confirmed in time }
 */
router.post('/deploy', validate({ body: deployContractSchema }), deployContract);

/**
 * @openapi
 * /v1/admin/contracts/init:
 *   post:
 *     tags: [Admin]
 *     summary: Initialize a deployed contract on a test or standalone network
 *     description: >
 *       Admin-only and gated by the `adminContractOps` feature flag. Invokes
 *       `method` on `contractId` with typed arguments. Integer values are
 *       decimal strings so 64/128-bit values keep full precision. Mainnet is
 *       always refused. The operation is recorded in the audit log.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, method]
 *             properties:
 *               contractId: { type: string, example: 'C...' }
 *               method: { type: string, example: init }
 *               args:
 *                 type: array
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   required: [type, value]
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [address, string, symbol, bool, u32, i32, u64, i64, u128, i128]
 *                     value: {}
 *     responses:
 *       200: { description: Contract initialized; returns the audit record }
 *       400: { description: Validation failed }
 *       401: { description: Missing or invalid token }
 *       403: { description: Caller is not an admin, or the network is mainnet }
 *       404: { description: Feature disabled }
 *       502: { description: Simulation, submission or execution failed }
 *       503: { description: Deployer account not configured }
 *       504: { description: Submitted but not confirmed in time }
 */
router.post('/init', validate({ body: initContractSchema }), initContract);

export default router;
