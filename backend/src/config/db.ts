import mongoose from 'mongoose';
import { env, isProd } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
// Reject unknown paths on write instead of silently dropping them — a typo in a
// field name should surface as an error, not as missing data.
mongoose.set('strict', 'throw');
if (!isProd) mongoose.set('debug', false);

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => logger.info('mongodb connected'));
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err: err?.message }, 'mongodb error'));

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
    // Atlas serves TLS by default; never disable certificate validation.
    autoIndex: !isProd,
  });

  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.connection.close();
}
