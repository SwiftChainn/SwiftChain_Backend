/**
 * Seed data for local development and demos.
 *
 * The CLI in `src/scripts/seed.ts` is a thin argument parser; this service owns
 * the database work so the same routines can be exercised by tests without
 * spawning a process. Every routine is idempotent: rows are matched on their
 * business key (user email, delivery id) and existing rows are skipped rather
 * than duplicated, so commands can be re-run safely.
 */

import User from '../models/User';
import Delivery, { DeliveryStatus } from '../models/Delivery';
import env from '../config/env';
import logger from '../config/logger';
import { UserRole, UserStatus } from '../interfaces/IUser';

export interface SeedOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /** Allow destructive/guarded operations (clearing data, running in production). */
  force?: boolean;
}

export interface SeedSummary {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
}

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  walletAddress?: string;
  isActive: boolean;
  status: UserStatus;
}

/** Password shared by every demo account; documented in the setup guide. */
export const DEMO_USER_PASSWORD = 'Password123!';

/** Stable demo accounts, matched by email when seeding. */
export const DEMO_USERS: readonly SeedUser[] = [
  {
    email: 'admin@swiftchain.dev',
    firstName: 'Ada',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    isActive: true,
    status: UserStatus.ACTIVE,
  },
  {
    email: 'sender@swiftchain.dev',
    firstName: 'Sam',
    lastName: 'Sender',
    role: UserRole.USER,
    isActive: true,
    status: UserStatus.ACTIVE,
  },
  {
    email: 'recipient@swiftchain.dev',
    firstName: 'Riley',
    lastName: 'Recipient',
    role: UserRole.USER,
    isActive: true,
    status: UserStatus.ACTIVE,
  },
  {
    email: 'driver@swiftchain.dev',
    firstName: 'Dana',
    lastName: 'Driver',
    role: UserRole.DRIVER,
    isActive: true,
    status: UserStatus.ACTIVE,
  },
];

/** Stable demo deliveries, matched by `deliveryId` when seeding. */
export const DEMO_DELIVERIES = [
  {
    deliveryId: 'DEL-001',
    driverId: 'DRV-001',
    userId: 'USR-001',
    pickupCoordinates: {
      lat: 40.7128,
      lng: -74.006,
      address: 'New York, NY',
    },
    dropoffCoordinates: {
      lat: 40.758,
      lng: -73.9855,
      address: 'Times Square, NY',
    },
    status: DeliveryStatus.PENDING,
  },
  {
    deliveryId: 'DEL-002',
    driverId: 'DRV-001',
    userId: 'USR-001',
    pickupCoordinates: {
      lat: 51.5074,
      lng: -0.1278,
      address: 'London, UK',
    },
    dropoffCoordinates: {
      lat: 51.5007,
      lng: -0.1246,
      address: 'Westminster, London',
    },
    status: DeliveryStatus.ASSIGNED,
  },
  {
    deliveryId: 'DEL-003',
    driverId: 'DRV-001',
    userId: 'USR-001',
    pickupCoordinates: {
      lat: 48.8566,
      lng: 2.3522,
      address: 'Paris, France',
    },
    dropoffCoordinates: {
      lat: 48.8584,
      lng: 2.2945,
      address: 'Eiffel Tower, Paris',
    },
    status: DeliveryStatus.COMPLETED,
  },
] as const;

const emptySummary = (): SeedSummary => ({ created: 0, updated: 0, skipped: 0, deleted: 0 });

/**
 * Validate the configuration a seed run needs before any write. Production is
 * guarded because demo accounts and passwords must never land in live data.
 *
 * @throws when MONGO_URI is blank or production is targeted without `force`.
 */
export const assertSeedEnvironment = (options: SeedOptions = {}): void => {
  if (!env.MONGODB_URI || !env.MONGODB_URI.trim()) {
    throw new Error('MONGODB_URI is required to run seed commands.');
  }

  if (env.NODE_ENV === 'production' && !options.force) {
    throw new Error('Refusing to seed production data without --force.');
  }
};

const logSummary = (command: string, summary: SeedSummary, dryRun: boolean): void => {
  logger.info(
    `[Seed] ${command} ${dryRun ? 'dry run' : 'complete'} — created=${summary.created} ` +
      `updated=${summary.updated} skipped=${summary.skipped} deleted=${summary.deleted}`,
  );
};

/** Create the demo accounts, skipping emails that already exist. */
export const seedUsers = async (options: SeedOptions = {}): Promise<SeedSummary> => {
  assertSeedEnvironment(options);
  const summary = emptySummary();

  for (const demoUser of DEMO_USERS) {
    const existing = await User.findOne({ email: demoUser.email }).lean();
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    summary.created += 1;
    if (options.dryRun) continue;

    await User.create({ ...demoUser, password: DEMO_USER_PASSWORD });
  }

  logSummary('seed:users', summary, Boolean(options.dryRun));
  return summary;
};

/** Create the demo deliveries, skipping delivery ids that already exist. */
export const seedDeliveries = async (options: SeedOptions = {}): Promise<SeedSummary> => {
  assertSeedEnvironment(options);
  const summary = emptySummary();

  for (const demoDelivery of DEMO_DELIVERIES) {
    const existing = await Delivery.findOne({ deliveryId: demoDelivery.deliveryId }).lean();
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    summary.created += 1;
    if (options.dryRun) continue;

    await Delivery.create({ ...demoDelivery });
  }

  logSummary('seed:deliveries', summary, Boolean(options.dryRun));
  return summary;
};

/** Users and deliveries together — the data a fresh demo environment needs. */
export const seedDemo = async (options: SeedOptions = {}): Promise<SeedSummary> => {
  assertSeedEnvironment(options);

  const users = await seedUsers(options);
  const deliveries = await seedDeliveries(options);

  return {
    created: users.created + deliveries.created,
    updated: users.updated + deliveries.updated,
    skipped: users.skipped + deliveries.skipped,
    deleted: 0,
  };
};

/**
 * Remove only the rows this service creates (matched by demo email and
 * delivery id), leaving unrelated development data untouched.
 */
export const clearSeedData = async (options: SeedOptions = {}): Promise<SeedSummary> => {
  assertSeedEnvironment(options);
  if (!options.force) {
    throw new Error('Refusing to clear seed data without --force.');
  }

  const deliveryIds = DEMO_DELIVERIES.map((delivery) => delivery.deliveryId);
  const emails = DEMO_USERS.map((user) => user.email);

  if (options.dryRun) {
    const summary: SeedSummary = {
      ...emptySummary(),
      deleted:
        (await Delivery.countDocuments({ deliveryId: { $in: deliveryIds } })) +
        (await User.countDocuments({ email: { $in: emails } })),
    };
    logSummary('seed:clear', summary, true);
    return summary;
  }

  const deliveries = await Delivery.deleteMany({ deliveryId: { $in: deliveryIds } });
  const users = await User.deleteMany({ email: { $in: emails } });
  const summary: SeedSummary = {
    ...emptySummary(),
    deleted: deliveries.deletedCount + users.deletedCount,
  };

  logSummary('seed:clear', summary, false);
  return summary;
};
