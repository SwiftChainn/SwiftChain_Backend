import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import User from '../models/User';
import { IAuthResponse, ILoginPayload } from '../interfaces/IUser';
import AppError from '../utils/AppError';
import logger from '../config/logger';

class AuthService {
  /**
   * Authenticate a user with email and password, returning a JWT token.
   *
   * Flow:
   * 1. Look up user by email (explicitly selecting the password field).
   * 2. Verify the account is active.
   * 3. Compare the provided password against the stored hash.
   * 4. Generate and return a signed JWT along with sanitized user data.
   */
  async login(payload: ILoginPayload): Promise<IAuthResponse> {
    const { email, password } = payload;

    // Find user by email — must explicitly select password since it's excluded by default
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      logger.warn(`Login attempt failed: no account found for email ${email}`);
      throw new AppError('Invalid email or password', StatusCodes.UNAUTHORIZED);
    }

    // Check if the account is active
    if (!user.isActive) {
      logger.warn(`Login attempt failed: deactivated account for email ${email}`);
      throw new AppError(
        'Your account has been deactivated. Please contact support.',
        StatusCodes.UNAUTHORIZED,
      );
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      logger.warn(`Login attempt failed: invalid password for email ${email}`);
      throw new AppError('Invalid email or password', StatusCodes.UNAUTHORIZED);
    }

    // Generate JWT
    const token = this.generateToken(user.id as string, user.role);

    logger.info(`User ${email} logged in successfully`);

    return {
      user: {
        id: user.id as string,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      token,
    };
  }

  /**
   * Generate a signed JWT token containing the user's ID and role.
   */
  private generateToken(userId: string, role: string): string {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new AppError(
        'JWT secret is not configured',
        StatusCodes.INTERNAL_SERVER_ERROR,
        false,
      );
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    return jwt.sign({ userId, role }, secret, {
      expiresIn,
    });
  }
}

export default new AuthService();
