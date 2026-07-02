import jwt from 'jsonwebtoken';
import logger from '../config/logger';
import User, { IUser } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_prod';

class AuthService {
  public verifyToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string } | null;
      if (!decoded) throw new Error('Invalid token');
      const userId = (decoded as any).sub || (decoded as any).id || (decoded as any)._id;
      if (!userId) throw new Error('Token missing subject');
      return { userId };
    } catch (error) {
      logger.warn('JWT verification failed', error);
      throw error;
    }
  }

  public async getUserById(id: string): Promise<IUser | null> {
    return User.findById(id).lean().exec() as unknown as IUser | null;
  }
}

export default new AuthService();
