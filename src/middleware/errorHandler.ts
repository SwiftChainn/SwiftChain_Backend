import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import logger from '../config/logger';
import AppError from '../utils/AppError';

interface MongooseValidationError extends Error {
  errors: Record<string, { message: string }>;
}

interface MongooseDuplicateKeyError extends Error {
  code: number;
  keyValue: Record<string, unknown>;
}

const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errors: Array<{ field: string; message: string }> | undefined;

  // Custom application errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Zod validation errors
  else if (err instanceof z.ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  }

  // Mongoose validation errors
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    const mongooseErr = err as MongooseValidationError;
    errors = Object.entries(mongooseErr.errors).map(([field, detail]) => ({
      field,
      message: detail.message,
    }));
  }

  // MongoDB duplicate key error
  else if ((err as MongooseDuplicateKeyError).code === 11000) {
    statusCode = 409;
    const duplicateErr = err as MongooseDuplicateKeyError;
    const field = Object.keys(duplicateErr.keyValue)[0];
    message = `An account with this ${field} already exists`;
  }

  // JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
  }

  logger.error(`${statusCode} - ${message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  const response: Record<string, unknown> = {
    status: 'error',
    statusCode,
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

export default errorHandler;
