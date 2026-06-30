import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import logger from './config/logger';

dotenv.config();

const app = express();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftchain';

app.use(cors());
app.use(express.json());

app.use('/api', routes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.path} not found`,
  });
});

// Connect to MongoDB but don't start the server here
const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};

// Call connectDB but don't listen
connectDB();

export default app;
