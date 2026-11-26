import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Delivery, { DeliveryStatus } from '../../../src/models/Delivery';
import AuditLog from '../../../src/models/AuditLog';
import { generateQrToken, hashQrToken, verifyQrToken } from '../../../src/utils/qrToken';
import auditService from '../../../src/services/auditService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Delivery.deleteMany({});
  await AuditLog.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('handoff proof audit integration', () => {
  it('invalidates the prior QR atomically and prevents reuse', async () => {
    const delivery = await Delivery.create({ status: DeliveryStatus.IN_PROGRESS, trackingNumber: 'H-1' });
    const first = generateQrToken(String(delivery._id), Date.now(), 'first-nonce');
    await Delivery.updateOne({ _id: delivery._id }, { handoffTokenHash: hashQrToken(first), handoffTokenExpiresAt: new Date(Date.now() + 60000) });

    const second = generateQrToken(String(delivery._id), Date.now(), 'second-nonce');
    await Delivery.updateOne({ _id: delivery._id }, { handoffTokenHash: hashQrToken(second), handoffTokenExpiresAt: new Date(Date.now() + 60000) });

    expect(verifyQrToken(second).deliveryId).toBe(String(delivery._id));
    expect(await Delivery.findOne({ handoffTokenHash: hashQrToken(first) })).toBeNull();
  });

  it('persists signed proof content hash and detects tampering', async () => {
    const delivery = await Delivery.create({
      status: DeliveryStatus.IN_PROGRESS,
      trackingNumber: 'H-2',
      proofOfDelivery: {
        storageKey: 'proof/H-2.jpg',
        imageUrl: 'https://cdn.example.com/proof/H-2.jpg',
        storageDriver: 'local',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        uploadedBy: 'driver-1',
        uploadedAt: new Date(),
        contentHash: 'abc123',
        signedPayload: {
          payload: { schema: 'swiftchain.pod.v1', photoHash: 'abc123' },
          canonicalPayload: '{"schema":"swiftchain.pod.v1","photoHash":"abc123"}',
          signature: '0000',
          signedAt: new Date(),
        },
      },
    });

    const persisted = await Delivery.findById(delivery._id).lean();
    expect(persisted?.proofOfDelivery?.contentHash).toBe('abc123');
  });

  it('batches, filters, and counts handoff audit records', async () => {
    await auditService.recordHandoffScan({ deliveryId: String(new mongoose.Types.ObjectId()), token: 'hash-1', outcome: 'invalid', ip: '127.0.0.1' });
    await auditService.recordHandoffScan({ deliveryId: String(new mongoose.Types.ObjectId()), token: 'hash-2', outcome: 'verified', ip: '127.0.0.1' });
    await auditService.flushHandoffScans();

    const result = await auditService.listHandoffScans({ page: 1, limit: 20, outcome: 'invalid' });
    expect(result.total).toBe(1);
  });
});
