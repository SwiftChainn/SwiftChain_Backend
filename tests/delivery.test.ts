import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';

// ─── Module mocks ──────────────────────────────────────────────────────────────

// Prevent the real DB connection in app.ts from firing during tests
jest.mock('../src/config/database', () => ({
  connectDatabase: jest.fn(),
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// ─── In-memory MongoDB ─────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

// MongoMemoryServer may need to download its binary on first run (can take >60s).
// Set an explicit timeout so Jest does not fail the hook prematurely.
const SETUP_TIMEOUT = 120_000; // 2 minutes

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, SETUP_TIMEOUT);

afterEach(async () => {
  // Clean up all collections between tests to keep them independent
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}, 15_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
}, 15_000);

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validAddress = {
  street: '123 Main St',
  city: 'Accra',
  state: 'Greater Accra',
  postalCode: '00233',
  country: 'Ghana',
};

const validSender = {
  name: 'Alice Mensah',
  email: 'alice@example.com',
  phone: '+233201234567',
  stellarAddress: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3SFZS522K',
  address: validAddress,
};

const validRecipient = {
  name: 'Bob Asante',
  email: 'bob@example.com',
  phone: '+233207654321',
  stellarAddress: 'GBVVNBZGZILHXKUQ7YSVUV7TVNXW3PFOSC7YWPXNZL7CZMHP5BSXQM',
  address: { ...validAddress, street: '456 Harbor Rd', city: 'Tema' },
};

const validPackageDetails = {
  weight: 2.5,
  dimensions: { length: 30, width: 20, height: 15 },
  description: 'Electronic components',
  fragile: true,
};

const validEscrow = {
  amount: 100,
  stellarAsset: 'XLM',
};

const validPayload = {
  sender: validSender,
  recipient: validRecipient,
  packageDetails: validPackageDetails,
  escrow: validEscrow,
  estimatedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  notes: 'Handle with care.',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/deliveries', () => {
  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('201 – successful creation', () => {
    it('returns 201 with status "success" and the created delivery document', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toBe('Delivery created successfully');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.delivery).toBeDefined();
    });

    it('returns the document with a generated _id and id string', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      const { delivery } = res.body.data;
      expect(delivery._id).toBeDefined();
      expect(delivery.id).toBeDefined();
      expect(typeof delivery.id).toBe('string');
    });

    it('sets status to "pending" by default', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      expect(res.body.data.delivery.status).toBe('pending');
    });

    it('generates a tracking number prefixed with "SWC-"', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      expect(res.body.data.delivery.trackingNumber).toMatch(/^SWC-/);
    });

    it('persists sender and recipient details correctly', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      const { delivery } = res.body.data;
      expect(delivery.sender.name).toBe(validSender.name);
      expect(delivery.sender.email).toBe(validSender.email.toLowerCase());
      expect(delivery.recipient.name).toBe(validRecipient.name);
    });

    it('persists packageDetails including dimensions', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      const { packageDetails } = res.body.data.delivery;
      expect(packageDetails.weight).toBe(validPackageDetails.weight);
      expect(packageDetails.fragile).toBe(true);
      expect(packageDetails.dimensions.length).toBe(30);
    });

    it('persists escrow amount and defaults stellarAsset to XLM when omitted', async () => {
      const payload = {
        ...validPayload,
        escrow: { amount: 50 }, // no stellarAsset
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.body.data.delivery.escrow.amount).toBe(50);
      expect(res.body.data.delivery.escrow.stellarAsset).toBe('XLM');
    });

    it('stores estimatedDeliveryDate when provided', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      expect(res.body.data.delivery.estimatedDeliveryDate).toBeDefined();
    });

    it('includes createdAt and updatedAt timestamps', async () => {
      const res = await request(app).post('/api/v1/deliveries').send(validPayload);

      const { delivery } = res.body.data;
      expect(delivery.createdAt).toBeDefined();
      expect(delivery.updatedAt).toBeDefined();
    });

    it('generates unique tracking numbers for two concurrent deliveries', async () => {
      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/deliveries').send(validPayload),
        request(app).post('/api/v1/deliveries').send(validPayload),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.delivery.trackingNumber).not.toBe(
        res2.body.data.delivery.trackingNumber,
      );
    });
  });

  // ── Validation errors (400) ──────────────────────────────────────────────────

  describe('400 – validation errors', () => {
    it('returns 400 when body is empty', async () => {
      const res = await request(app).post('/api/v1/deliveries').send({});

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    it('returns 400 when sender is missing', async () => {
      const { sender: _s, ...payload } = validPayload;
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sender/i);
    });

    it('returns 400 when recipient is missing', async () => {
      const { recipient: _r, ...payload } = validPayload;
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/recipient/i);
    });

    it('returns 400 when packageDetails is missing', async () => {
      const { packageDetails: _p, ...payload } = validPayload;
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/packageDetails/i);
    });

    it('returns 400 when escrow is missing', async () => {
      const { escrow: _e, ...payload } = validPayload;
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/escrow/i);
    });

    it('returns 400 when sender.email is missing', async () => {
      const payload = {
        ...validPayload,
        sender: { ...validSender, email: undefined },
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sender\.email/i);
    });

    it('returns 400 when sender.stellarAddress is missing', async () => {
      const payload = {
        ...validPayload,
        sender: { ...validSender, stellarAddress: undefined },
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sender\.stellarAddress/i);
    });

    it('returns 400 when packageDetails.weight is a negative number', async () => {
      const payload = {
        ...validPayload,
        packageDetails: { ...validPackageDetails, weight: -1 },
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/weight/i);
    });

    it('returns 400 when packageDetails.fragile is not a boolean', async () => {
      const payload = {
        ...validPayload,
        packageDetails: { ...validPackageDetails, fragile: 'yes' },
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/fragile/i);
    });

    it('returns 400 when escrow.amount is negative', async () => {
      const payload = { ...validPayload, escrow: { amount: -10 } };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/escrow\.amount/i);
    });
  });

  // ── Business rule errors (422) ───────────────────────────────────────────────

  describe('422 – business rule violations', () => {
    it('returns 422 when sender and recipient share the same Stellar address', async () => {
      const sharedAddress = validSender.stellarAddress;
      const payload = {
        ...validPayload,
        recipient: { ...validRecipient, stellarAddress: sharedAddress },
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/stellar address/i);
    });

    it('returns 422 when estimatedDeliveryDate is in the past', async () => {
      const payload = {
        ...validPayload,
        estimatedDeliveryDate: new Date(Date.now() - 86400000).toISOString(),
      };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/future date/i);
    });

    it('returns 400 when estimatedDeliveryDate is not a valid date string', async () => {
      const payload = { ...validPayload, estimatedDeliveryDate: 'not-a-date' };
      const res = await request(app).post('/api/v1/deliveries').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/ISO 8601/i);
    });
  });

  // ── Wrong method / not found ─────────────────────────────────────────────────

  describe('routing', () => {
    it('returns 404 for GET /api/v1/deliveries (route not defined)', async () => {
      const res = await request(app).get('/api/v1/deliveries');
      expect(res.status).toBe(404);
    });
  });
});
