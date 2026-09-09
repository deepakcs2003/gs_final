import { Router, type Request, type Response } from 'express';
import { Order } from '../models/commerce.js';
import { Setting } from '../models/analytics.js';
import { logger } from '../utils/logger.js';
import { applyTrackingToOrder, parseTrackStatus } from '../services/shipping/shiprocket.js';
import { getShiprocketSettings } from '../services/shipping/shiprocket-settings.js';

/**
 * Shiprocket webhooks. There is no HMAC to verify, so the payload is treated as
 * untrusted: it is matched idempotently to an existing order/shipment and only
 * ever refreshes tracking on that matching shipment. Replays are safe.
 *
 * Mounted at /api/webhooks with express.raw BEFORE the JSON parser and before
 * CSRF (see app.ts) — a webhook carries no cookies.
 */
const router = Router();

const strOf = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim() : '');

/**
 * Persists an audit receipt so the admin panel can show "Webhook: Connected /
 * last received at" without trusting our own side of the conversation.
 */
export async function recordWebhookReceipt(provider: string): Promise<void> {
  const now = new Date();
  await Setting.updateOne(
    { key: `${provider}WebhookCount` },
    { $inc: { value: 1 } },
    { upsert: true },
  ).catch((err: unknown) => logger.warn({ err: (err as Error).message }, 'webhook receipt count failed'));
  await Setting.updateOne(
    { key: `${provider}WebhookLastAt` },
    { $set: { value: now, updatedAt: now } },
    { upsert: true },
  ).catch((err: unknown) => logger.warn({ err: (err as Error).message }, 'webhook receipt timestamp failed'));
}

router.post('/shiprocket', async (req: Request, res: Response) => {
  const silentOk = () => res.json({ ok: true, matched: false });
  try {
    let parsed: unknown = req.body;
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8');
      parsed = text ? JSON.parse(text) : {};
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const trackingData =
      body.tracking_data && typeof body.tracking_data === 'object' ? (body.tracking_data as Record<string, unknown>) : {};

    const awb = strOf(body.awb) || strOf(body.awb_code) || strOf(trackingData.awb_code);
    const shipmentId = strOf(body.shipment_id) || strOf(body.shipmentId) || strOf(trackingData.shipment_id);
    const orderId = strOf(body.order_id) || strOf(body.shiprocketOrderId) || strOf((body.order as { id?: string })?.id);

    const or: Array<Record<string, string>> = [];
    if (awb) or.push({ 'shipping.awb': awb });
    if (shipmentId) or.push({ 'shipping.shipmentId': shipmentId });
    if (orderId) or.push({ 'shipping.shiprocketOrderId': orderId });
    if (or.length === 0) return silentOk();

    const order = await Order.findOne({ $or: or }).exec();
    if (!order) return silentOk();

    const task = await getShiprocketSettings();
    if (task.trackingSync) {
      const rawStatus =
        strOf(trackingData.track_status) || strOf(trackingData.current_status) || strOf(trackingData.status) || '';
      const firstEvent =
        Array.isArray(trackingData.shipment_track) && trackingData.shipment_track.length
          ? (trackingData.shipment_track[0] as Record<string, unknown>)
          : null;
      const track = parseTrackStatus(rawStatus, strOf(firstEvent?.status), {
        etd: strOf(trackingData.etd) || null,
        lastEventAt: strOf(firstEvent?.date) || null,
      });
      await applyTrackingToOrder(order, track, 'Shiprocket webhook');
    }

    await recordWebhookReceipt('shiprocket');
    res.json({ ok: true, matched: true });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'shiprocket webhook handler failed');
    res.json({ ok: true, matched: false });
  }
});

export default router;