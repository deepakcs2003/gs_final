import { pino } from 'pino';
import { isProd } from '../config/env.js';

/**
 * Redaction is defence-in-depth: even if a handler accidentally logs a whole
 * request or config object, credentials and PII are censored on the way out.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-razorpay-signature"]',
      'res.headers["set-cookie"]',
      'password',
      'otp',
      'code',
      'codeHash',
      'token',
      'refreshToken',
      'accessToken',
      '*.password',
      '*.otp',
      '*.token',
      '*.secret',
      '*.authKey',
      'MONGODB_URI',
      'JWT_SECRET',
      'CSRF_SECRET',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'CLOUDINARY_API_SECRET',
      'SHIPROCKET_PASSWORD',
      'WHATSAPP_TEST_ACCESS_TOKEN',
      'WHATSAPP_PRODUCTION_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
    ],
    censor: '[redacted]',
  },
  transport: isProd ? undefined : { target: 'pino/file', options: { destination: 1 } },
});
