import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum DeliveryStatus {
  PENDING = 'pending',       // Created off-chain, not yet submitted to Soroban
  ON_CHAIN = 'on_chain',     // Transaction submitted and confirmed on Stellar
  IN_TRANSIT = 'in_transit', // Courier has picked up the package
  DELIVERED = 'delivered',   // Package delivered, escrow can be released
  DISPUTED = 'disputed',     // A dispute has been raised
  CANCELLED = 'cancelled',   // Delivery was cancelled before pick-up
}

// ─── Sub-document interfaces ───────────────────────────────────────────────────

export interface IAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IPackageDetails {
  weight: number;       // kg
  dimensions?: {
    length: number;     // cm
    width: number;      // cm
    height: number;     // cm
  };
  description: string;
  fragile: boolean;
}

export interface IEscrow {
  amount: number;         // Amount in XLM
  stellarAsset: string;   // Asset code, e.g. 'XLM' or 'USDC'
  contractId?: string;    // Soroban contract ID — populated after on-chain creation
  txHash?: string;        // Stellar transaction hash — populated after on-chain creation
}

// ─── Main document interface ───────────────────────────────────────────────────

export interface IDelivery extends Document {
  _id: Types.ObjectId;
  trackingNumber: string;
  status: DeliveryStatus;

  sender: {
    name: string;
    email: string;
    phone: string;
    stellarAddress: string;
    address: IAddress;
  };

  recipient: {
    name: string;
    email: string;
    phone: string;
    stellarAddress: string;
    address: IAddress;
  };

  packageDetails: IPackageDetails;
  escrow: IEscrow;

  estimatedDeliveryDate?: Date;
  actualDeliveryDate?: Date;
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-document schemas ──────────────────────────────────────────────────────

const AddressSchema = new Schema<IAddress>(
  {
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const PackageDetailsSchema = new Schema<IPackageDetails>(
  {
    weight: { type: Number, required: true, min: 0 },
    dimensions: {
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
    },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    fragile: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const EscrowSchema = new Schema<IEscrow>(
  {
    amount: { type: Number, required: true, min: 0 },
    stellarAsset: { type: String, required: true, trim: true, default: 'XLM' },
    contractId: { type: String, trim: true },
    txHash: { type: String, trim: true },
  },
  { _id: false },
);

// ─── Main schema ───────────────────────────────────────────────────────────────

const DeliverySchema = new Schema<IDelivery>(
  {
    trackingNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(DeliveryStatus),
      required: true,
      default: DeliveryStatus.PENDING,
      index: true,
    },

    sender: {
      name: { type: String, required: true, trim: true },
      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid sender email address'],
      },
      phone: { type: String, required: true, trim: true },
      stellarAddress: { type: String, required: true, trim: true },
      address: { type: AddressSchema, required: true },
    },

    recipient: {
      name: { type: String, required: true, trim: true },
      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid recipient email address'],
      },
      phone: { type: String, required: true, trim: true },
      stellarAddress: { type: String, required: true, trim: true },
      address: { type: AddressSchema, required: true },
    },

    packageDetails: { type: PackageDetailsSchema, required: true },
    escrow: { type: EscrowSchema, required: true },

    estimatedDeliveryDate: { type: Date },
    actualDeliveryDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,  // auto-manages createdAt / updatedAt
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        // Expose id as a plain string instead of keeping only _id
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  },
);

// ─── Model ─────────────────────────────────────────────────────────────────────

const Delivery = model<IDelivery>('Delivery', DeliverySchema);

export default Delivery;
