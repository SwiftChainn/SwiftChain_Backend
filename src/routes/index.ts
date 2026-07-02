import { Router } from 'express';
import deliveryRoutes from './deliveryRoutes';

const router = Router();

router.use('/v1/deliveries', deliveryRoutes);

export default router;
