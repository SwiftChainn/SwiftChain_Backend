import { Router } from 'express';
import authController from '../controllers/authController';
import validate from '../middleware/validate';
import { loginSchema } from '../validators/authValidator';
import { register } from '../controllers/authController';

const router = Router();

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and return JWT token
 * @access  Public
 */
router.post('/login', validate(loginSchema), authController.login);
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', register);

export default router;
