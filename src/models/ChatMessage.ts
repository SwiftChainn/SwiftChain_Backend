import mongoose, { Document, Model } from 'mongoose';

export interface IChatMessage extends Document {
  content: string;
  sender?: string;
  createdAt: Date;
}

const ChatMessageSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },
    sender: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const ChatMessage =
  (mongoose.models.ChatMessage as Model<IChatMessage>) ||
  mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);

export default ChatMessage;
