import User, { type IUser } from '../models/User';
import ApiError from '../utils/ApiError';
import type { RegisterInput } from '../validators/authValidator';

/**
 * Public-facing representation of a user, with the password hash removed.
 */
export type SafeUser = Omit<IUser, 'password'> & { id: string };

/**
 * Register a new user.
 *
 * Persists the user (the password is hashed by the model's pre-save hook)
 * and returns a sanitized representation that never exposes the hash.
 *
 * @throws {ApiError} 409 if a user with the same email already exists.
 */
export const registerUser = async (input: RegisterInput): Promise<SafeUser> => {
  const existingUser = await User.findOne({ email: input.email }).lean().exec();
  if (existingUser) {
    throw ApiError.conflict('A user with this email already exists');
  }

  try {
    const user = await User.create(input);
    // `toJSON` strips the password hash and internal fields.
    return user.toJSON() as unknown as SafeUser;
  } catch (error) {
    // Guard against a race condition where the unique index rejects a
    // concurrent insert after the existence check above.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      throw ApiError.conflict('A user with this email already exists');
    }
    throw error;
  }
};

export default { registerUser };
