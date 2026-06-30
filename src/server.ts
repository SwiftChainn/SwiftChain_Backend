import app from './app';
import logger from './config/logger';

const PORT = process.env.PORT || 3000;

// Start the server from here
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  logger.info(`📝 Health check: http://localhost:${PORT}/health`);
  logger.info(`📦 ETA endpoint: http://localhost:${PORT}/api/v1/deliveries/:id/eta`);
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
