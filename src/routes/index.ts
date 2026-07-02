import { Router } from 'express';
import deliveryRoutes from './delivery';

const router = Router();

router.use('/deliveries', deliveryRoutes);

export default router;
