import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  MONGODB_URI: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  BCRYPT_ROUNDS: number;
  LOG_LEVEL: string;
  CORS_ORIGIN: string;
}

const getEnvVar = (key: string, fallback?: string): string => {
  const value = process.env[key] || fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const env: EnvConfig = {
  NODE_ENV: getEnvVar('NODE_ENV', 'development'),
  PORT: parseInt(getEnvVar('PORT', '3000'), 10),
  MONGODB_URI: getEnvVar('MONGODB_URI', 'mongodb://localhost:27017/swiftchain'),
  JWT_SECRET: getEnvVar('JWT_SECRET'),
  JWT_EXPIRES_IN: getEnvVar('JWT_EXPIRES_IN', '7d'),
  BCRYPT_ROUNDS: parseInt(getEnvVar('BCRYPT_ROUNDS', '10'), 10),
  LOG_LEVEL: getEnvVar('LOG_LEVEL', 'debug'),
  CORS_ORIGIN: getEnvVar('CORS_ORIGIN', '*'),
};

export default env;
