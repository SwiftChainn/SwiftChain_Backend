import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import authService from '../services/authService';
import asyncHandler from '../utils/asyncHandler';
import { ILoginPayload } from '../interfaces/IUser';

class AuthController {
  /**
   * POST /api/v1/auth/login
   *
   * Authenticate a user with email and password.
   * Returns a JWT token and sanitized user data on success.
   */
  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const loginPayload: ILoginPayload = {
      email: req.body.email,
      password: req.body.password,
    };

    const result = await authService.login(loginPayload);

    res.status(StatusCodes.OK).json({
      status: 'success',
      message: 'Login successful',
      data: result,
    });
  });
}

export default new AuthController();
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
