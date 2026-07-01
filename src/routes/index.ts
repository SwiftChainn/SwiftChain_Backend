import { Router } from 'express';
import deliveryRoutes from './deliveries';

const router = Router();

router.use('/deliveries', deliveryRoutes);

export default router;
