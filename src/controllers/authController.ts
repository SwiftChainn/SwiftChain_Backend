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
