import { Socket, Namespace } from 'socket.io';
import authService from '../services/authService';
import logger from '../config/logger';

export interface AuthenticatedSocket extends Socket {
  data: { user?: any };
}

/**
 * Socket.io middleware to authenticate connections using JWT.
 * Expects token to be provided in `socket.handshake.auth.token` or `socket.handshake.query.token`.
 */
const socketAuth = async (socket: Socket, next: (err?: any) => void) => {
  try {
    const token =
      // prefer auth payload
      (socket.handshake &&
        (socket.handshake as any).auth &&
        (socket.handshake as any).auth.token) ||
      // fallback to query string
      (socket.handshake &&
        (socket.handshake as any).query &&
        (socket.handshake as any).query.token);

    if (!token) {
      logger.warn('Socket auth failed: missing token');
      return next(new Error('Unauthorized'));
    }

    const { userId } = authService.verifyToken(token as string);
    const user = await authService.getUserById(userId);
    if (!user) {
      logger.warn('Socket auth failed: user not found');
      return next(new Error('Unauthorized'));
    }

    // Attach user to socket data for downstream handlers
    (socket as AuthenticatedSocket).data = { ...(socket as any).data, user };

    return next();
  } catch (err) {
    logger.warn('Socket auth verification error', err);
    return next(new Error('Unauthorized'));
  }
};

export default socketAuth;
