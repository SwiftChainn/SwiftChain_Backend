import { Router } from 'express';
import { createDelivery } from '../controllers/deliveryController';

const router = Router();

/**
 * @route   POST /api/v1/deliveries
 * @desc    Create a new delivery and store its off-chain metadata
 * @access  Public (authentication to be layered on in a future issue)
 */
router.post('/', createDelivery);

export default router;
