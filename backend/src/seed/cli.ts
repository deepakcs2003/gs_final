/** `npm run seed` — seeds whatever MONGODB_URI points at. */
import { connectDb, disconnectDb } from '../config/db.js';
import { seedDatabase } from './seed.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  await connectDb();
  await seedDatabase();
  await disconnectDb();
}

main().catch(async (err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'seed failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
