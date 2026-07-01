import { isValidObjectId } from 'mongoose';
import { Delivery, DeliveryDocument, DeliveryStatus } from '../models/deliveryModel';
import { HttpError } from '../utils/httpError';

const statusTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ['assigned'],
  assigned: ['picked_up'],
  picked_up: ['in_transit'],
  in_transit: ['delivered'],
  delivered: [],
};

export const allowedStatuses = Object.keys(statusTransitions) as DeliveryStatus[];

export const isValidDeliveryStatus = (status: string): status is DeliveryStatus => {
  return allowedStatuses.includes(status as DeliveryStatus);
};

const isValidTransition = (current: DeliveryStatus, next: DeliveryStatus): boolean => {
  return statusTransitions[current].includes(next);
};

export class DeliveryService {
  static async updateDeliveryStatus(id: string, status: DeliveryStatus): Promise<DeliveryDocument> {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Invalid delivery id');
    }

    const delivery = await Delivery.findById(id);

    if (!delivery) {
      throw new HttpError(404, 'Delivery not found');
    }

    if (delivery.status === status) {
      return delivery;
    }

    if (!isValidTransition(delivery.status, status)) {
      const availableNext = statusTransitions[delivery.status].join(', ') || 'none';
      throw new HttpError(
        400,
        `Invalid status transition from '${delivery.status}' to '${status}'. Allowed next statuses: ${availableNext}`,
      );
    }

    delivery.status = status;
    await delivery.save();

    return delivery;
  }
}
