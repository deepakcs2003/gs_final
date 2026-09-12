import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env, integrations, whatsapp } from '../config/env.js';
import { MessageLog } from '../models/whatsapp.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { adminReadLimiter, adminWriteLimiter } from '../middleware/rateLimit.js';
import { maskMobile, sendTemplateMessage } from '../services/whatsapp/client.js';
import { badRequest, serviceUnavailable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Admin-only WhatsApp integration controls, mounted at /api/whatsapp.
 *
 *  POST /test   → sends a REAL message through Meta (test credentials by
 *                 default) and returns the Meta message id synchronously.
 *                 This is the "does the whole chain actually work" check.
 *  GET  /status → exposes which credential set is active + what's configured,
 *                 without ever leaking the access token / app secret.
 *
 * The webhook lives at /api/whatsapp/webhook (raw body, no auth — the HMAC
 * signature is the auth) and is mounted separately in app.ts BEFORE the JSON
 * parser.
 */
const router = Router();

const waTestSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+?\d{10,15}$/, 'Phone number galat format mein hai')
      .optional(),
  })
  .strict();

router.post(
  '/test',
  requireAdmin('SUPER_ADMIN'),
  adminWriteLimiter,
  validate({ body: waTestSchema }),
  async (req: Request, res: Response) => {
    const body = (req as Request & { validated: { body: z.infer<typeof waTestSchema> } }).validated.body;
    const candidates = [
      body.phone?.replace(/[^\d]/g, '') ?? '',
      env.ADMIN_MOBILE ?? '',
      ...whatsapp.testNumbers,
    ].filter((m) => /^\d{10,15}$/.test(m));
    const mobile = candidates[0];
    if (!mobile) {
      throw badRequest('WhatsApp test number configure karein (WHATSAPP_TEST_NUMBERS ya ADMIN_MOBILE).');
    }

    logger.info(
      { mobile: maskMobile(mobile), mode: whatsapp.mode },
      'whatsapp integration test — direct Meta send start',
    );

    // hello_world is Meta's always-available sample template (en_US) — the
    // natural "Step 1 smoke test". A real approved Guddi Silai template would
    // work the same way; swap templateName once guddi_* templates are approved.
    const result = await sendTemplateMessage({ mobile, templateName: 'hello_world', language: 'en_US' });

    if (!result.ok) {
      logger.warn(
        { mobile: maskMobile(mobile), code: result.code, message: result.message },
        'whatsapp integration test failed',
      );
      await MessageLog.create({
        mobile,
        type: 'TEST',
        category: 'UTILITY',
        templateName: 'hello_world',
        status: 'FAILED',
        failureReason: result.message.slice(0, 400),
        mode: whatsapp.mode,
        errorCode: result.meta?.code ?? 0,
        dedupeKey: `test:${mobile}:${Date.now()}`,
      });
      throw serviceUnavailable(`WhatsApp send fail (${result.code}): ${result.message}`);
    }

    await MessageLog.create({
      mobile,
      type: 'TEST',
      category: 'UTILITY',
      templateName: 'hello_world',
      status: 'SENT',
      metaMessageId: result.wamid,
      sentAt: new Date(),
      mode: result.mode,
      dedupeKey: `test:${mobile}:${Date.now()}`,
    });

    res.json({
      success: true,
      messageId: result.wamid,
      mode: result.mode,
      transport: result.transport,
      to: maskMobile(mobile),
    });
  },
);

router.get('/status', requireAdmin('SUPER_ADMIN'), adminReadLimiter, async (_req: Request, res: Response) => {
  res.json({
    configured: integrations.whatsapp,
    enabled: whatsapp.enabled,
    mode: whatsapp.mode,
    phoneNumberId: whatsapp.phoneNumberId || null,
    businessAccountId: whatsapp.businessAccountId || null,
    apiVersion: whatsapp.apiVersion,
    verifyTokenSet: Boolean(whatsapp.verifyToken),
    appSecretSet: Boolean(whatsapp.appSecret),
    testNumbers: whatsapp.testNumbers.map((n) => maskMobile(n)),
    webhookUrl: `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/whatsapp/webhook`,
  });
});

export default router;