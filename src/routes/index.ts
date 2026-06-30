import { Router } from 'express';
import stellarRoutes from './stellar.routes';

const router = Router();

// ─── Stellar / Soroban ──────────────────────────────────────────────────────
router.use('/stellar', stellarRoutes);

// ─── Future routes ──────────────────────────────────────────────────────────
// router.use('/auth', authRoutes);
// router.use('/users', userRoutes);
// router.use('/deliveries', deliveryRoutes);

export default router;
