import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

// Auth routes
router.use('/auth', authRoutes);

export default router;
