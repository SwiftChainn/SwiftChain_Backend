import { Server } from 'socket.io';
import registerSocketHandlers from './socketController';
import logger from '../config/logger';
import socketAuth from '../middlewares/socketAuth';

export const initSocket = (httpServer: any) => {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  const nsp = io.of('/api/v1/realtime');

  // Attach authentication middleware to namespace
  nsp.use((socket, next) => socketAuth(socket as any, next as any));

  nsp.on('connection', (socket) => {
    registerSocketHandlers(socket, nsp);
  });

  logger.info('✅ Socket.io initialized on namespace /api/v1/realtime');

  return io;
};

export default initSocket;
