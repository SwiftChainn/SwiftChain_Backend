/**
 * Tests for the seed service. Real models run against an in-memory MongoDB so
 * unique indexes and password hashing behave as they do in development.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../src/models/User';
import Delivery from '../src/models/Delivery';
import { UserRole } from '../src/interfaces/IUser';
import {
  clearSeedData,
  DEMO_DELIVERIES,
  DEMO_USERS,
  seedDeliveries,
  seedDemo,
  seedUsers,
} from '../src/services/seedService';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Delivery.init();
}, 120_000);

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Delivery.deleteMany({})]);
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('seedUsers', () => {
  it('creates the demo accounts with hashed passwords', async () => {
    const summary = await seedUsers();

    expect(summary).toMatchObject({ created: DEMO_USERS.length, skipped: 0 });
    expect(await User.countDocuments({})).toBe(DEMO_USERS.length);

    const driver = await User.findOne({ email: 'driver@swiftchain.dev' }).select('+password');
    expect(driver?.role).toBe(UserRole.DRIVER);
    expect(driver?.password).not.toBe('Password123!');
    await expect(driver!.comparePassword('Password123!')).resolves.toBe(true);
  });

  it('is idempotent and skips existing accounts on a second run', async () => {
    await seedUsers();
    const summary = await seedUsers();

    expect(summary).toMatchObject({ created: 0, skipped: DEMO_USERS.length });
    expect(await User.countDocuments({})).toBe(DEMO_USERS.length);
  });

  it('writes nothing in dry-run mode but reports what would be created', async () => {
    const summary = await seedUsers({ dryRun: true });

    expect(summary).toMatchObject({ created: DEMO_USERS.length, skipped: 0 });
    expect(await User.countDocuments({})).toBe(0);
  });
});

describe('seedDeliveries', () => {
  it('creates the demo deliveries and skips them on a re-run', async () => {
    const first = await seedDeliveries();
    const second = await seedDeliveries();

    expect(first).toMatchObject({ created: DEMO_DELIVERIES.length, skipped: 0 });
    expect(second).toMatchObject({ created: 0, skipped: DEMO_DELIVERIES.length });
    expect(await Delivery.countDocuments({})).toBe(DEMO_DELIVERIES.length);
    expect(await Delivery.findOne({ deliveryId: 'DEL-001' }).lean()).toMatchObject({
      deliveryId: 'DEL-001',
      status: 'pending',
    });
  });

  it('updates nothing in dry-run mode', async () => {
    const summary = await seedDeliveries({ dryRun: true });

    expect(summary.created).toBe(DEMO_DELIVERIES.length);
    expect(await Delivery.countDocuments({})).toBe(0);
  });
});

describe('seedDemo', () => {
  it('seeds users and deliveries and reports the combined totals', async () => {
    const summary = await seedDemo();

    expect(summary).toMatchObject({
      created: DEMO_USERS.length + DEMO_DELIVERIES.length,
      skipped: 0,
    });
    expect(await User.countDocuments({})).toBe(DEMO_USERS.length);
    expect(await Delivery.countDocuments({})).toBe(DEMO_DELIVERIES.length);
  });
});

describe('clearSeedData', () => {
  it('refuses to clear without --force', async () => {
    await seedDemo();

    await expect(clearSeedData()).rejects.toThrow('--force');
    expect(await User.countDocuments({})).toBe(DEMO_USERS.length);
    expect(await Delivery.countDocuments({})).toBe(DEMO_DELIVERIES.length);
  });

  it('removes only the demo rows when forced', async () => {
    await seedDemo();
    await User.create({
      email: 'real-user@example.com',
      password: 'Password123!',
      firstName: 'Real',
      lastName: 'User',
    });
    await Delivery.create({ deliveryId: 'REAL-001', status: 'pending' });

    const summary = await clearSeedData({ force: true });

    expect(summary.deleted).toBe(DEMO_USERS.length + DEMO_DELIVERIES.length);
    expect(await User.countDocuments({})).toBe(1);
    expect(await Delivery.countDocuments({})).toBe(1);
    expect(await User.findOne({ email: 'real-user@example.com' })).not.toBeNull();
  });

  it('reports the rows it would delete in dry-run mode', async () => {
    await seedDemo();

    const summary = await clearSeedData({ force: true, dryRun: true });

    expect(summary.deleted).toBe(DEMO_USERS.length + DEMO_DELIVERIES.length);
    expect(await User.countDocuments({})).toBe(DEMO_USERS.length);
    expect(await Delivery.countDocuments({})).toBe(DEMO_DELIVERIES.length);
  });
});
