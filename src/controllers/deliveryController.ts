import { Request, Response, NextFunction } from 'express';
import { DeliveryService, allowedStatuses, isValidDeliveryStatus } from '../services/deliveryService';
import { HttpError } from '../utils/httpError';

interface UpdateDeliveryStatusRequest extends Request {
  params: {
    id: string;
  };
  body: {
    status?: string;
  };
}

export const updateDeliveryStatus = async (
  req: UpdateDeliveryStatusRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || typeof status !== 'string') {
      throw new HttpError(400, 'Status is required and must be a string');
    }

    if (!isValidDeliveryStatus(status)) {
      throw new HttpError(
        400,
        `Status must be one of: ${allowedStatuses.join(', ')}`,
      );
    }

    const delivery = await DeliveryService.updateDeliveryStatus(id, status);

    res.status(200).json({
      status: 'success',
      data: delivery,
    });
  } catch (error) {
    next(error);
  }
};
