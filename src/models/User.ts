import { Schema, model, type Document, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';

const DEFAULT_BCRYPT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserRole = 'user' | 'admin';

/**
 * Plain user properties as stored in the database.
 */
export interface IUser {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document for a user, including instance methods.
 */
export interface IUserDocument extends IUser, Document {
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUserDocument>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [EMAIL_REGEX, 'A valid email address is required'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret): Record<string, unknown> => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/**
 * Hash the password with bcrypt before persisting whenever it changes.
 */
userSchema.pre<IUserDocument>('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    next();
    return;
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || DEFAULT_BCRYPT_ROUNDS;
  const salt = await bcrypt.genSalt(rounds);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * Compare a plaintext candidate password against the stored hash.
 */
userSchema.methods.comparePassword = async function comparePassword(
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

const User: Model<IUserDocument> = model<IUserDocument>('User', userSchema);

export default User;
