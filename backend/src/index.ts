import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env, integrations } from './config/env.js';
import { logger } from './utils/logger.js';
import { startWaWorker } from './services/whatsapp/queue.js';

async function main(): Promise<void> {
  await connectDb();

  // WhatsApp outbox worker: drains queued messages every few seconds so HTTP
  // requests never block on Meta (order flow pays 0 cost if WhatsApp is down).
  const waWorker = startWaWorker();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        // Which integrations are live — names and booleans only, no secrets.
        integrations,
      },
      'guddi silai api ready',
    );
  });

  server.headersTimeout = 65_000;
  server.requestTimeout = 60_000;

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(waWorker);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Don't let a hung connection block the deploy forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });
}

main().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to start');
  process.exit(1);
});
