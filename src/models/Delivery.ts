import mongoose, { Document, Schema } from 'mongoose';

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'disputed';

export interface ISender {
  userId?: string;
  name: string;
  contact: string;
  address: string;
}

export interface IRecipient {
  name: string;
  contact: string;
  address: string;
}

export interface IDelivery extends Document {
  trackingId: string;
  sender: ISender;
  recipient: IRecipient;
  packageDescription: string;
  weight?: number;
  estimatedValue?: number;
  driverId?: string;
  status: DeliveryStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SenderSchema = new Schema<ISender>(
  {
    userId: { type: String },
    name: { type: String, required: true },
    contact: { type: String, required: true },
    address: { type: String, required: true },
  },
  { _id: false },
);

const RecipientSchema = new Schema<IRecipient>(
  {
    name: { type: String, required: true },
    contact: { type: String, required: true },
    address: { type: String, required: true },
  },
  { _id: false },
);

const DeliverySchema = new Schema<IDelivery>(
  {
    trackingId: { type: String, required: true, unique: true, index: true },
    sender: { type: SenderSchema, required: true },
    recipient: { type: RecipientSchema, required: true },
    packageDescription: { type: String, required: true },
    weight: { type: Number },
    estimatedValue: { type: Number },
    driverId: { type: String, index: true },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled', 'disputed'],
      default: 'pending',
      index: true,
    },
    notes: { type: String },
  },
  { timestamps: true },
);

export default mongoose.model<IDelivery>('Delivery', DeliverySchema);
