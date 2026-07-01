import mongoose from 'mongoose';
import logger from './logger';
import env from './env';

export const connectDatabase = async (): Promise<void> => {
  try {
    const mongoUri = env.MONGODB_URI;

    await mongoose.connect(mongoUri);

    logger.info('✅ Connected to MongoDB successfully');

    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};
