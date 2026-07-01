/**
 * Custom application error class that extends the native Error.
 * Carries an HTTP status code so the global error handler can
 * respond with the correct status without any extra mapping.
 */
class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);

    this.statusCode = statusCode;
    // Operational errors are expected (bad input, not found, etc.).
    // Programmer errors should NOT set this flag.
    this.isOperational = true;

    // Restore the prototype chain so `instanceof AppError` works correctly
    // after TypeScript compiles down to ES5.
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace, excluding the constructor frame itself
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
