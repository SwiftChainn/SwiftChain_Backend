import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { IUser } from '../interfaces/IUser';
import { adminContractService } from '../services/adminContractService';
import { sendSuccess } from '../utils/responseWrapper';
import type { DeployContractBody, InitContractBody } from '../validators/adminContractValidator';

/** Id of the authenticated admin; `authenticate` guarantees `req.user`. */
const requesterId = (req: Request): string => String((req as Request & { user: IUser }).user._id);

/**
 * POST /api/v1/admin/contracts/deploy
 * Deploy a contract instance from an uploaded WASM hash.
 */
export const deployContract = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { wasmHash, salt } = req.body as DeployContractBody;
    const operation = await adminContractService.deploy({
      wasmHash,
      salt,
      requestedBy: requesterId(req),
    });
    sendSuccess(res, { operation }, 'Contract deployed successfully', StatusCodes.CREATED);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/contracts/init
 * Invoke a deployed contract's initialization function.
 */
export const initContract = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { contractId, method, args } = req.body as InitContractBody;
    const operation = await adminContractService.init({
      contractId,
      method,
      args,
      requestedBy: requesterId(req),
    });
    sendSuccess(res, { operation }, 'Contract initialized successfully', StatusCodes.OK);
  } catch (error) {
    next(error);
  }
};
