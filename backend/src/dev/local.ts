/**
 * Zero-setup local mode: `npm run dev:local`.
 *
 * Starts an in-memory MongoDB, seeds the demo catalogue into it and boots the
 * API — useful for looking at the site without an Atlas connection, or for
 * working offline. `npm run dev` and production always use the real
 * MONGODB_URI from .env.
 *
 * Dev-only: nothing in the server imports this file.
 */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('dev:local must never run in production');
  }

  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'guddi_silai' } });

  // These must be set before anything imports config/env.ts, which reads
  // process.env once at module load. The secrets are throwaway — this database
  // is discarded when the process exits.
  process.env.NODE_ENV ??= 'development';
  process.env.MONGODB_URI = mongo.getUri('guddi_silai');
  process.env.APP_BASE_URL ??= 'http://localhost:5173';
  process.env.API_BASE_URL ??= 'http://localhost:4000';
  process.env.CORS_ORIGINS ??= 'http://localhost:5173';
  process.env.JWT_SECRET ??= crypto.randomBytes(48).toString('base64url');
  process.env.CSRF_SECRET ??= crypto.randomBytes(48).toString('base64url');

  const [{ connectDb }, { seedDatabase }, { createApp }, { env }, { logger }] = await Promise.all([
    import('../config/db.js'),
    import('../seed/seed.js'),
    import('../app.js'),
    import('../config/env.js'),
    import('../utils/logger.js'),
  ]);

  logger.info('in-memory mongodb started — all data is discarded on exit');

  await connectDb();
  await seedDatabase();

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'guddi silai api ready (local in-memory mode)');
  });

  const shutdown = async () => {
    server.close();
    await mongo.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('dev:local failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
