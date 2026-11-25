import EventLog from '../models/EventLog';
import Delivery from '../models/Delivery';
import { indexerLog } from '../utils/indexerLog';
import { emitDeliveryStatusUpdated } from '../sockets/connectionHandler';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';
export interface IndexerStatusData {
  eventType: string;
  contractId: string;
  lastProcessedLedger: number;
  currentLedger: number;
  lag: number;
  updatedAt: Date;
}

export interface DeliveryStatusUpdatedEvent {
  contractId: string;
  deliveryId: string;
  newStatus: string;
}

export class IndexerService {
  private readonly rpcClient: ISorobanRpcClient;

  constructor(rpcClient: ISorobanRpcClient = defaultSorobanRpcClient) {
    this.rpcClient = rpcClient;
  }

  public async getIndexerStatus(): Promise<IndexerStatusData[]> {
    try {
      const currentLedgerResponse = await this.rpcClient.getLatestLedger();
      const currentLedger = currentLedgerResponse.sequence;
      const logs = await EventLog.find({}).lean();
      return logs.map((log) => {
        const lastProcessedLedger = Number(log.ledgerSequence ?? 0);
        return {
          eventType: log.eventType,
          contractId: log.contractId ?? '',
          lastProcessedLedger,
          currentLedger,
          lag: Math.max(0, currentLedger - lastProcessedLedger),
          updatedAt: log.updatedAt,
        };
      });
    } catch (error) {
      indexerLog(
        'error',
        '[IndexerService] Error fetching indexer status',
        {},
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }
  }

  public async processDeliveryStatusUpdated(event: DeliveryStatusUpdatedEvent): Promise<void> {
    const { contractId, deliveryId, newStatus } = event;
    const context = { eventType: 'delivery', contractId, entityId: deliveryId };
    try {
      const updatedDelivery = await Delivery.findOneAndUpdate(
        { _id: deliveryId, contractId },
        { status: newStatus },
        { new: true, runValidators: true },
      ).lean();
      if (!updatedDelivery) {
        indexerLog('warn', '[IndexerService] Delivery not found for status update', context, {
          newStatus,
        });
        return;
      }
      // Push the transition to any connected realtime clients (no-op when the
      // socket namespace has not been initialised, e.g. in tests).
      emitDeliveryStatusUpdated(deliveryId, {
        contractId,
        deliveryId,
        status: newStatus,
      });
      indexerLog('debug', '[IndexerService] Delivery status updated', context, { newStatus });
    } catch (error) {
      indexerLog(
        'error',
        '[IndexerService] Error processing delivery_status_updated event',
        context,
        {
          newStatus,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }
}

export const indexerService = new IndexerService();
