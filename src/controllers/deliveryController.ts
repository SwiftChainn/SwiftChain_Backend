import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as deliveryService from '../services/deliveryService';
import { CreateDeliveryInput } from '../services/deliveryService';
import AppError from '../utils/AppError';

// ─── Request body type ─────────────────────────────────────────────────────────

type CreateDeliveryBody = CreateDeliveryInput;

// ─── Validation helpers ────────────────────────────────────────────────────────

/**
 * Returns a list of missing required field paths for an address object.
 */
const validateAddress = (address: unknown, prefix: string): string[] => {
  const errors: string[] = [];
  const required = ['street', 'city', 'state', 'postalCode', 'country'] as const;

  if (typeof address !== 'object' || address === null) {
    return [`${prefix} is required and must be an object`];
  }

  const addr = address as Record<string, unknown>;
  for (const field of required) {
    if (!addr[field] || typeof addr[field] !== 'string') {
      errors.push(`${prefix}.${field} is required`);
    }
  }
  return errors;
};

/**
 * Returns a list of missing / invalid fields for a sender or recipient object.
 */
const validateParty = (party: unknown, role: 'sender' | 'recipient'): string[] => {
  const errors: string[] = [];

  if (typeof party !== 'object' || party === null) {
    return [`${role} is required and must be an object`];
  }

  const p = party as Record<string, unknown>;

  if (!p.name || typeof p.name !== 'string') errors.push(`${role}.name is required`);
  if (!p.email || typeof p.email !== 'string') errors.push(`${role}.email is required`);
  if (!p.phone || typeof p.phone !== 'string') errors.push(`${role}.phone is required`);
  if (!p.stellarAddress || typeof p.stellarAddress !== 'string') {
    errors.push(`${role}.stellarAddress is required`);
  }

  errors.push(...validateAddress(p.address, `${role}.address`));

  return errors;
};

/**
 * Validates the top-level request body and returns an array of error messages.
 * An empty array means the body is valid.
 */
const validateCreateDeliveryBody = (body: Partial<CreateDeliveryBody>): string[] => {
  const errors: string[] = [];

  errors.push(...validateParty(body.sender, 'sender'));
  errors.push(...validateParty(body.recipient, 'recipient'));

  // packageDetails
  if (typeof body.packageDetails !== 'object' || body.packageDetails === null) {
    errors.push('packageDetails is required and must be an object');
  } else {
    // Cast through unknown to allow dynamic key access on the typed sub-object
    const pkg = body.packageDetails as unknown as Record<string, unknown>;
    if (typeof pkg['weight'] !== 'number' || (pkg['weight'] as number) < 0) {
      errors.push('packageDetails.weight must be a non-negative number');
    }
    if (!pkg['description'] || typeof pkg['description'] !== 'string') {
      errors.push('packageDetails.description is required');
    }
    if (typeof pkg['fragile'] !== 'boolean') {
      errors.push('packageDetails.fragile must be a boolean');
    }
    if (pkg['dimensions'] !== undefined) {
      const dims = pkg['dimensions'] as Record<string, unknown>;
      for (const dim of ['length', 'width', 'height']) {
        if (typeof dims[dim] !== 'number' || (dims[dim] as number) < 0) {
          errors.push(`packageDetails.dimensions.${dim} must be a non-negative number`);
        }
      }
    }
  }

  // escrow
  if (typeof body.escrow !== 'object' || body.escrow === null) {
    errors.push('escrow is required and must be an object');
  } else {
    // Cast through unknown to allow dynamic key access on the typed sub-object
    const escrow = body.escrow as unknown as Record<string, unknown>;
    if (typeof escrow['amount'] !== 'number' || (escrow['amount'] as number) < 0) {
      errors.push('escrow.amount must be a non-negative number');
    }
    if (escrow['stellarAsset'] !== undefined && typeof escrow['stellarAsset'] !== 'string') {
      errors.push('escrow.stellarAsset must be a string');
    }
  }

  return errors;
};

// ─── Controller ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/deliveries
 *
 * Creates a new delivery record (off-chain metadata only).
 * The on-chain Soroban contract interaction happens in a subsequent step.
 */
export const createDelivery = async (
  req: Request<unknown, unknown, CreateDeliveryBody>,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const validationErrors = validateCreateDeliveryBody(req.body);

    if (validationErrors.length > 0) {
      throw new AppError(
        `Validation failed: ${validationErrors.join('; ')}`,
        StatusCodes.BAD_REQUEST,
      );
    }

    const delivery = await deliveryService.createDelivery(req.body);

    res.status(StatusCodes.CREATED).json({
      status: 'success',
      message: 'Delivery created successfully',
      data: {
        delivery,
      },
    });
  } catch (error) {
    next(error);
  }
};
