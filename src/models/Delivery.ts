import mongoose, { Document, Schema, Model, Query } from 'mongoose';
import logger from '../config/logger';

export enum DeliveryStatus {
  PENDING = 'Pending',
  ASSIGNED = 'Assigned',
  PICKED_UP = 'Picked Up',
  IN_TRANSIT = 'In Transit',
  DELIVERED = 'Delivered',
  CANCELLED = 'Cancelled',
}

export enum DeliverySize {
  SMALL = 'Small',
  MEDIUM = 'Medium',
  LARGE = 'Large',
  EXTRA_LARGE = 'Extra Large',
}

export interface ILocation {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  instructions?: string;
}

export interface IPackage {
  description: string;
  weight: number;
  size: DeliverySize;
  itemValue?: number;
  isFragile: boolean;
  requiresSignature: boolean;
}

export interface IDelivery extends Document {
  trackingNumber: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  pickup: ILocation;
  dropoff: ILocation;
  package: IPackage;
  status: DeliveryStatus;
  driver?: mongoose.Types.ObjectId;
  estimatedDistance?: number;
  estimatedDuration?: number;
  deliveryFee: number;
  escrowAmount: number;
  stellarTransactionId?: string;
  notes?: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;

  softDelete(userId?: string): Promise<IDelivery>;
  restore(): Promise<IDelivery>;
}

export interface IDeliveryModel extends Model<IDelivery> {
  findAvailable(): Promise<IDelivery[]>;
}

const locationSchema = new Schema<ILocation>(
  {
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    zipCode: { type: String, required: true, trim: true },
    lat: { type: Number },
    lng: { type: Number },
    instructions: { type: String, trim: true },
  },
  { _id: false },
);

const packageSchema = new Schema<IPackage>(
  {
    description: { type: String, required: true, trim: true },
    weight: { type: Number, required: true, min: 0 },
    size: { type: String, enum: Object.values(DeliverySize), required: true },
    itemValue: { type: Number, min: 0 },
    isFragile: { type: Boolean, default: false },
    requiresSignature: { type: Boolean, default: false },
  },
  { _id: false },
);

const deliverySchema = new Schema<IDelivery, IDeliveryModel>(
  {
    trackingNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    customer: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },
    pickup: { type: locationSchema, required: true },
    dropoff: { type: locationSchema, required: true },
    package: { type: packageSchema, required: true },
    status: {
      type: String,
      enum: Object.values(DeliveryStatus),
      default: DeliveryStatus.PENDING,
      index: true,
    },
    driver: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    estimatedDistance: { type: Number, min: 0 },
    estimatedDuration: { type: Number, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    escrowAmount: { type: Number, required: true, min: 0 },
    stellarTransactionId: { type: String, trim: true },
    notes: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>): void {
        delete ret.__v;
      },
    },
  },
);

deliverySchema.pre<Query<IDelivery, IDelivery>>('find', function (next) {
  if ((this.getOptions() as Record<string, unknown>).includeDeleted) {
    return next();
  }
  this.where({ isDeleted: false });
  next();
});

deliverySchema.pre<Query<IDelivery, IDelivery>>('findOne', function (next) {
  if ((this.getOptions() as Record<string, unknown>).includeDeleted) {
    return next();
  }
  this.where({ isDeleted: false });
  next();
});

deliverySchema.pre<Query<IDelivery, IDelivery>>('findOneAndUpdate', function (next) {
  if ((this.getOptions() as Record<string, unknown>).includeDeleted) {
    return next();
  }
  this.where({ isDeleted: false });
  next();
});

deliverySchema.pre<Query<IDelivery, IDelivery>>('countDocuments', function (next) {
  if ((this.getOptions() as Record<string, unknown>).includeDeleted) {
    return next();
  }
  this.where({ isDeleted: false });
  next();
});

deliverySchema.methods.softDelete = async function (
  this: IDelivery,
  userId?: string,
): Promise<IDelivery> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (userId) {
    this.deletedBy = new mongoose.Types.ObjectId(userId);
  }
  logger.info(`Delivery ${this.trackingNumber} soft-deleted`);
  return this.save();
};

deliverySchema.methods.restore = async function (this: IDelivery): Promise<IDelivery> {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = undefined;
  logger.info(`Delivery ${this.trackingNumber} restored`);
  return this.save();
};

deliverySchema.statics.findAvailable = async function (): Promise<IDelivery[]> {
  return this.find({ status: DeliveryStatus.PENDING, driver: null }).sort({ createdAt: -1 }).exec();
};

deliverySchema.index({ status: 1, isDeleted: 1 });
deliverySchema.index({ 'customer.phone': 1 });
deliverySchema.index({ createdAt: -1 });

const Delivery = mongoose.model<IDelivery, IDeliveryModel>('Delivery', deliverySchema);

export default Delivery;
