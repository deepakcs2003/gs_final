import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import { recordWebhookReceipt } from './webhooks.js';
import { authorizedWaWebhook, handleWaWebhook, webhookChallenge } from '../services/whatsapp/webhook.js';

/**
 * WhatsApp webhooks, mounted at /api/webhooks/whatsapp with express.raw BEFORE
 * the JSON parser (signature check needs exact body bytes — see app.ts). No
 * cookies, no CSRF, no rate limiting: Meta is the only caller and the HMAC
 * signature is the authentication.
 */
const router = Router();

router.get('/', (req: Request, res: Response) => {
  const challenge = webhookChallenge({ ...req.query });
  if (challenge !== null) {
    res.setHeader('Content-Type', 'text/plain');
    res.send(challenge);
    return;
  }
  res.status(403).send('Verification failed');
});

router.post('/', (req: Request, res: Response) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = req.header('x-hub-signature-256');
  if (!authorizedWaWebhook(raw, signature)) {
    res.status(403).json({ ok: false, error: 'Invalid signature' });
    return;
  }

  void (async () => {
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as unknown;
      const result = await handleWaWebhook(parsed);
      await recordWebhookReceipt('whatsapp');
      logger.info({ updated: result.updated, reason: result.reason ?? null }, 'whatsapp webhook handled');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'whatsapp webhook handler failed');
    }
  })();

  res.json({ ok: true });
});

export default router;