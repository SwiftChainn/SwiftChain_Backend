import { Router } from 'express';
import { deliveryController } from '../controllers/delivery.controller';

const router = Router();

router.post('/', deliveryController.create.bind(deliveryController));
router.get('/', deliveryController.list.bind(deliveryController));
router.get('/archived', deliveryController.listArchived.bind(deliveryController));
router.get('/:id', deliveryController.getById.bind(deliveryController));
router.patch('/:id', deliveryController.update.bind(deliveryController));
router.patch('/:id/archive', deliveryController.archive.bind(deliveryController));
router.patch('/:id/restore', deliveryController.restore.bind(deliveryController));

export default router;
