import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { registerUser } from '../services/authService';
import { validateRegisterInput } from '../validators/authValidator';
import asyncHandler from '../utils/asyncHandler';

/**
 * POST /api/v1/auth/register
 *
 * Registers a new user. The request body is validated, the password is
 * securely hashed by the model layer, and the created user is returned
 * without the password hash.
 */
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = validateRegisterInput(req.body);
  const user = await registerUser(input);

  res.status(StatusCodes.CREATED).json({
    status: 'success',
    message: 'User registered successfully',
    data: { user },
  });
});

export default { register };
