import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  DRIVER = 'driver',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
}

// ─── Document interface ────────────────────────────────────────────────────────

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  stellarAddress?: string;
  suspendedAt?: Date;
  suspendedReason?: string;
  createdAt: Date;
  updatedAt: Date;

  /** Returns true when the plain-text password matches the stored hash. */
  comparePassword(candidate: string): Promise<boolean>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
      // Never return the password hash in query results by default
      select: false,
    },

    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
      default: UserRole.USER,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(UserStatus),
      required: true,
      default: UserStatus.ACTIVE,
      index: true,
    },

    stellarAddress: {
      type: String,
      trim: true,
    },

    // Audit fields set when an admin suspends/bans the account
    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        // Never leak the password hash over the wire
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Hash password before save when it has been modified. */
UserSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) return next();

  const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);
  this.password = await bcrypt.hash(this.password, rounds);
  next();
});

// ─── Instance methods ──────────────────────────────────────────────────────────

UserSchema.methods.comparePassword = async function (
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password as string);
};

// ─── Model ────────────────────────────────────────────────────────────────────

const User = model<IUser>('User', UserSchema);

export default User;
