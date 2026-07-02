import { Router } from 'express';
import { register } from '../controllers/authController';

const router = Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', register);

export default router;
