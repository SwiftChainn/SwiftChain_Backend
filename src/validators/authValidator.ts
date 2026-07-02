import ApiError from '../utils/ApiError';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MIN_NAME_LENGTH = 2;

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Validate and normalize the registration request body.
 *
 * Throws an {@link ApiError} (400) describing the first validation failure.
 */
export const validateRegisterInput = (body: unknown): RegisterInput => {
  if (typeof body !== 'object' || body === null) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  const { name, email, password } = body as Record<string, unknown>;

  if (!isNonEmptyString(name) || name.trim().length < MIN_NAME_LENGTH) {
    throw ApiError.badRequest(
      `Name is required and must be at least ${MIN_NAME_LENGTH} characters`,
    );
  }

  if (!isNonEmptyString(email) || !EMAIL_REGEX.test(email.trim())) {
    throw ApiError.badRequest('A valid email address is required');
  }

  if (!isNonEmptyString(password) || password.length < MIN_PASSWORD_LENGTH) {
    throw ApiError.badRequest(
      `Password is required and must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
  };
};
