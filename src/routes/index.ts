import { Router } from 'express';
import deliveryRoutes from './deliveryRoutes';
import adminRoutes from './adminRoutes';

const router = Router();

// Define your routes here
// router.use('/auth', authRoutes);
// router.use('/users', userRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/admin', adminRoutes);

export default router;
