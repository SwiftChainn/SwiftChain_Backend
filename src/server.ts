import app from './app';
import logger from './config/logger';
import initSocket from './sockets';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  logger.info(`📝 Health check: http://localhost:${PORT}/health`);
});

// Initialize Socket.io
const io = initSocket(server);

// Graceful shutdown
const gracefulShutdown = (): void => {
  logger.info('Received shutdown signal, closing gracefully...');

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');

    // Close socket.io if present
    try {
      if (io && typeof io.close === 'function') {
        // close all sockets
        // @ts-ignore
        io.close(() => logger.info('Socket.io server closed'));
      }
    } catch (err) {
      logger.warn('Error while closing Socket.io', err);
    }

    import('mongoose').then(({ default: mongoose }) => {
      mongoose.connection.close(false).then(() => {
        logger.info('MongoDB connection closed');
        process.exit(0);
      });
    });
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('unhandledRejection', (error: Error) => {
  logger.error('Unhandled Rejection:', error);
  gracefulShutdown();
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});

export default server;
