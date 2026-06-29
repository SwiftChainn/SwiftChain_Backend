import { StatusCodes } from 'http-status-codes';
import Delivery, { IDelivery, DeliveryStatus } from '../models/Delivery';
import AppError from '../utils/AppError';
import logger from '../config/logger';

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface PartyInput {
  name: string;
  email: string;
  phone: string;
  stellarAddress: string;
  address: AddressInput;
}

export interface PackageDetailsInput {
  weight: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  description: string;
  fragile: boolean;
}

export interface EscrowInput {
  amount: number;
  stellarAsset?: string; // defaults to 'XLM'
}

export interface CreateDeliveryInput {
  sender: PartyInput;
  recipient: PartyInput;
  packageDetails: PackageDetailsInput;
  escrow: EscrowInput;
  estimatedDeliveryDate?: string; // ISO 8601 string from the client
  notes?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generates a unique tracking number in the format SWC-<timestamp>-<random hex>.
 * Collision probability is negligible for reasonable traffic volumes.
 */
const generateTrackingNumber = (): string => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SWC-${ts}-${rand}`;
};

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * Creates a new delivery record in MongoDB.
 *
 * Business rules enforced here (not in the controller):
 *  - Sender and recipient Stellar addresses must differ.
 *  - Estimated delivery date, if provided, must be in the future.
 *  - New deliveries always start with status PENDING.
 *  - A unique tracking number is generated server-side.
 */
export const createDelivery = async (input: CreateDeliveryInput): Promise<IDelivery> => {
  const {
    sender,
    recipient,
    packageDetails,
    escrow,
    estimatedDeliveryDate,
    notes,
  } = input;

  // Business rule: sender and recipient cannot share the same Stellar address
  if (sender.stellarAddress === recipient.stellarAddress) {
    throw new AppError(
      'Sender and recipient Stellar addresses must be different.',
      StatusCodes.UNPROCESSABLE_ENTITY,
    );
  }

  // Business rule: estimated delivery date must be in the future
  let parsedEstimatedDate: Date | undefined;
  if (estimatedDeliveryDate) {
    parsedEstimatedDate = new Date(estimatedDeliveryDate);
    if (isNaN(parsedEstimatedDate.getTime())) {
      throw new AppError(
        'estimatedDeliveryDate must be a valid ISO 8601 date string.',
        StatusCodes.BAD_REQUEST,
      );
    }
    if (parsedEstimatedDate <= new Date()) {
      throw new AppError(
        'estimatedDeliveryDate must be a future date.',
        StatusCodes.UNPROCESSABLE_ENTITY,
      );
    }
  }

  const trackingNumber = generateTrackingNumber();

  logger.info(`Creating new delivery with tracking number: ${trackingNumber}`);

  const delivery = await Delivery.create({
    trackingNumber,
    status: DeliveryStatus.PENDING,
    sender,
    recipient,
    packageDetails,
    escrow: {
      amount: escrow.amount,
      stellarAsset: escrow.stellarAsset ?? 'XLM',
    },
    estimatedDeliveryDate: parsedEstimatedDate,
    notes,
  });

  logger.info(`Delivery created successfully. ID: ${delivery._id}, Tracking: ${trackingNumber}`);

  return delivery;
};
