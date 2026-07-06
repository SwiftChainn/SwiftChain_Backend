import { Router } from 'express';
import {
  createDelivery,
  getDeliveries,
  getDeliveryById,
  assignDriver,
} from '../controllers/deliveryController';

const router = Router();

router.post('/', createDelivery);
router.get('/', getDeliveries);
router.get('/:id', getDeliveryById);
router.put('/:id/assign', assignDriver);

export default router;
