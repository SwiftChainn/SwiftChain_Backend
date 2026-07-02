import mongoose, { Document, Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  name?: string;
  role?: string;
  password?: string;
  createdAt: Date;
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    role: { type: String, default: 'user' },
    password: { type: String },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false },
);

const User = (mongoose.models.User as Model<IUser>) || mongoose.model<IUser>('User', UserSchema);

export default User;
