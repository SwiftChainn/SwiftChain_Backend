import http from 'http';
import app from './app';
import logger from './config/logger';
import { initializeSocketServer, shutdownSocketServer, TypedServer } from './sockets/connectionHandler';

const PORT = env.PORT;

// Start the server from here
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  logger.info(`📝 Health check: http://localhost:${PORT}/health`);
  logger.info(`📦 ETA endpoint: http://localhost:${PORT}/api/v1/deliveries/:id/eta`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const gracefulShutdown = async (): Promise<void> => {
  logger.info('Received shutdown signal, closing gracefully...');

  try {
    // 1. Stop accepting new WebSocket connections and close existing ones
    await shutdownSocketServer(io);

    // 2. Stop accepting new HTTP requests
    httpServer.close(async () => {
      logger.info('HTTP server closed');

      try {
        const { default: mongoose } = await import('mongoose');
        await mongoose.connection.close(false);
        logger.info('MongoDB connection closed');
      } catch (dbErr) {
        logger.error('Error closing MongoDB connection:', dbErr);
      }

      process.exit(0);
    });
  } catch (err) {
    logger.error('Error during graceful shutdown:', err);
    process.exit(1);
  }

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => void gracefulShutdown());
process.on('SIGINT', () => void gracefulShutdown());

process.on('unhandledRejection', (error: Error) => {
  logger.error('Unhandled Rejection:', error);
  void gracefulShutdown();
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  void gracefulShutdown();
});

export default httpServer;
