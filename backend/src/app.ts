import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pinoHttp } from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './utils/logger.js';
import { csrfIssue, csrfProtect } from './middleware/csrf.js';
import { attachUser } from './middleware/auth.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import catalogRouter from './routes/catalog.js';
import authRouter from './routes/auth.js';
import cartRouter from './routes/cart.js';
import measurementsRouter from './routes/measurements.js';
import ordersRouter from './routes/orders.js';
import paymentsRouter from './routes/payments.js';
import webhooksRouter from './routes/webhooks.js';
import waWebhookRouter from './routes/waWebhook.js';
import whatsappRouter from './routes/whatsapp.js';
import miscRouter from './routes/misc.js';
import adminRouter from './routes/admin.js';

export function createApp(): Express {
  const app = express();

  // Behind a single reverse proxy / CDN. This is what makes req.ip the real
  // client address, which every rate limit depends on. Setting `true` instead
  // would let a client spoof X-Forwarded-For and dodge every limit.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API returns JSON only — nothing here should ever be able to load a
      // script, embed a frame, or be framed by someone else.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  app.use(
    cors({
      // Explicit allow-list. Reflecting the request origin would defeat the
      // point of cookies being SameSite=Lax + credentialed.
      origin(origin, callback) {
        const localDevOrigin = isProd
          ? false
          : /^https?:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin ?? '');
        if (!origin || env.CORS_ORIGINS.includes(origin) || localDevOrigin) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Session-Id'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' },
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'Guddi Silai API is running successfully',
      service: 'Guddi Silai Backend',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * The Razorpay webhook is mounted before the JSON parser and before CSRF.
   * It needs the exact bytes for signature verification, carries no cookies,
   * and is authenticated by that signature alone.
   */
  app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '512kb' }));
  app.use('/api/payments', paymentsRouter);

  /**
   * Shiprocket webhooks get the same treatment: raw bytes (there is no
   * signature to verify, but we still need the JSON), no cookies, no CSRF.
   * Matching is idempotent — see routes/webhooks.ts.
   */
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '512kb' }));
  app.use('/api/webhooks', webhooksRouter);

  /**
   * WhatsApp delivery-status webhook gets the same raw-bytes treatment: the
   * X-Hub-Signature-256 HMAC is computed over the exact request body, so the
   * JSON parser must not touch it first. No cookies, no CSRF — Meta signs.
   * Canonical URL: /api/whatsapp/webhook (older /api/webhooks/whatsapp still
   * works — both hit the same handler).
   */
  app.use('/api/whatsapp/webhook', express.raw({ type: '*/*', limit: '512kb' }));
  app.use('/api/whatsapp/webhook', waWebhookRouter);
  app.use('/api/webhooks/whatsapp', express.raw({ type: '*/*', limit: '512kb' }));
  app.use('/api/webhooks/whatsapp', waWebhookRouter);

  // 256kb is generous for a cart or an order and small enough that a flood of
  // large bodies cannot exhaust memory.
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use(csrfIssue);
  app.use(attachUser);
  app.use(generalLimiter);

  // Every state-changing request under /api must present a matching token.
  app.use('/api', csrfProtect);

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/measurements', measurementsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api', catalogRouter);
  app.use('/api', miscRouter);

  // Production serves the built SPA on the same origin so the single `/api`
  // cookie domain from the frontend keeps working. Non-API GET requests fall
  // through to index.html for client-side routing.
  if (env.PUBLIC_DIR) {
    const publicRoot = resolve(process.cwd(), env.PUBLIC_DIR);
    if (existsSync(publicRoot)) {
      app.use(
        express.static(publicRoot, {
          index: 'index.html',
          maxAge: '1h',
          immutable: false,
          etag: true,
        }),
      );
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) {
          next();
          return;
        }
        res.sendFile(resolve(publicRoot, 'index.html'));
      });
    } else {
      console.error(`PUBLIC_DIR "${env.PUBLIC_DIR}" not found — SPA hosting disabled; API-only.`);
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
