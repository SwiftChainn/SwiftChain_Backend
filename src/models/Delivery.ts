import mongoose, { Schema, Document } from 'mongoose';

export interface IDelivery extends Document {
  deliveryId: string;
  driverId: string;
  userId: string;
  pickupCoordinates: {
    lat: number;
    lng: number;
    address: string;
  };
  dropoffCoordinates: {
    lat: number;
    lng: number;
    address: string;
  };
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  distance?: number;
  estimatedDuration?: number;
  actualDuration?: number;
  createdAt: Date;
  updatedAt: Date;
}

const DeliverySchema = new Schema<IDelivery>(
  {
    deliveryId: { type: String, required: true, unique: true },
    driverId: { type: String, required: true },
    userId: { type: String, required: true },
    pickupCoordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, required: true },
    },
    dropoffCoordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    distance: { type: Number },
    estimatedDuration: { type: Number },
    actualDuration: { type: Number },
  },
  { timestamps: true }
);

export const Delivery = mongoose.model<IDelivery>('Delivery', DeliverySchema);
