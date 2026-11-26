/**
 * Seed CLI for local development.
 *
 *   npm run seed              # demo deliveries (same command name as before)
 *   npm run seed:users
 *   npm run seed:deliveries
 *   npm run seed:demo         # users + deliveries
 *   npm run seed:clear        # removes only the demo rows
 *
 * Flags:
 *   --dry-run   Report what would change without writing.
 *   --force     Required for seed:clear, and to allow seeding in production.
 *
 * Destructive commands and production runs are refused without `--force`; see
 * `assertSeedEnvironment` in `src/services/seedService.ts`.
 */

import mongoose from 'mongoose';
import env from '../config/env';
import logger from '../config/logger';
import {
  clearSeedData,
  seedDeliveries,
  seedDemo,
  seedUsers,
  type SeedOptions,
  type SeedSummary,
} from '../services/seedService';

const COMMANDS = ['users', 'deliveries', 'demo', 'clear'] as const;
type SeedCommand = (typeof COMMANDS)[number];

interface ParsedArgs {
  command: SeedCommand;
  options: SeedOptions;
}

const USAGE = `Usage: ts-node src/scripts/seed.ts <${COMMANDS.join('|')}> [--dry-run] [--force]`;

const isSeedCommand = (value: string): value is SeedCommand =>
  (COMMANDS as readonly string[]).includes(value);

export const parseSeedArgs = (argv: string[]): ParsedArgs => {
  const [command, ...flags] = argv;

  if (!command || !isSeedCommand(command)) {
    throw new Error(USAGE);
  }

  const options: SeedOptions = {};
  for (const flag of flags) {
    if (flag === '--dry-run') {
      options.dryRun = true;
    } else if (flag === '--force') {
      options.force = true;
    } else {
      throw new Error(`Unknown option '${flag}'.\n${USAGE}`);
    }
  }

  return { command, options };
};

const runCommand = async (command: SeedCommand, options: SeedOptions): Promise<SeedSummary> => {
  switch (command) {
    case 'users':
      return seedUsers(options);
    case 'deliveries':
      return seedDeliveries(options);
    case 'demo':
      return seedDemo(options);
    case 'clear':
      return clearSeedData(options);
  }
};

const main = async (): Promise<void> => {
  const { command, options } = parseSeedArgs(process.argv.slice(2));

  await mongoose.connect(env.MONGODB_URI);
  try {
    const summary = await runCommand(command, options);
    logger.info(
      `[Seed] Done — created=${summary.created} updated=${summary.updated} ` +
        `skipped=${summary.skipped} deleted=${summary.deleted}`,
    );
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(`[Seed] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
