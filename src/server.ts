import app from './app';
import logger from './config/logger';
import env from './config/env';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${env.NODE_ENV} mode`);
  logger.info(`📝 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
const gracefulShutdown = (): void => {
  logger.info('Received shutdown signal, closing gracefully...');

  server.close(() => {
    logger.info('HTTP server closed');
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
