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
import { Error as MongooseError } from 'mongoose';
import logger from '../config/logger';
import env from '../config/env';
import { AppError } from '../errors/AppError';

const handleCastErrorDB = (err: MongooseError.CastError): AppError => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err: { errmsg?: string; code?: number }): AppError => {
  const value = err.errmsg?.match(/(["'])(\\?.)*?\1/)?.[0] || '';
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err: MongooseError.ValidationError): AppError => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

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
const sendErrorDev = (err: AppError, _req: Request, res: Response): void => {
  res.status(err.statusCode).json({
    status: 'error',
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err: AppError, _req: Request, res: Response): void => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  } else {
    logger.error('ERROR 💥', err);

    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

const errorHandler = (
  err: Error & {
    statusCode?: number;
    name?: string;
    code?: number;
    errmsg?: string;
    errors?: Record<string, MongooseError.ValidatorError>;
  },
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let error: AppError;

  if (err.name === 'CastError') {
    error = handleCastErrorDB(err as MongooseError.CastError);
  } else if (err.code === 11000) {
    error = handleDuplicateFieldsDB(err);
  } else if (err.name === 'ValidationError') {
    error = handleValidationErrorDB(err as MongooseError.ValidationError);
  } else if (err instanceof AppError) {
    error = err;
  } else {
    error = new AppError(err.message || 'Internal Server Error', err.statusCode || 500);
  }

  logger.error(
    `${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`,
  );

  if (env.NODE_ENV === 'development') {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

export default errorHandler;
