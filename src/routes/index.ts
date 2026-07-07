import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

// Auth routes
router.use('/auth', authRoutes);
import deliveryRoutes from './deliveryRoutes';

const router = Router();

router.use('/v1/deliveries', deliveryRoutes);

export default router;
