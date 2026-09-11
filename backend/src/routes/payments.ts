import { Router, type Request, type Response } from 'express';
import { Order } from '../models/commerce.js';
import { verifyWebhookSignature } from '../services/payment/razorpay.js';
import { markPaid, markPaymentFailed } from './orders.js';
import { logger } from '../utils/logger.js';
import { getPublicKeyId, razorpayEnabled } from '../services/payment/razorpay.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* POST /api/payments/webhook                                                  */
/* -------------------------------------------------------------------------- */

interface WebhookEvent {
  event?: string;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
  };
}

/**
 * Razorpay's server-to-server notification — the authoritative record of what
 * was actually paid. It runs before the JSON body parser (see app.ts) because
 * the signature covers the exact bytes sent; re-serialising parsed JSON would
 * change them and every verification would fail.
 *
 * No cookies, no CSRF: this request is authenticated purely by the HMAC.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.get('x-razorpay-signature');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;

  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    logger.warn({ path: req.path }, 'rejected webhook with invalid signature');
    // Deliberately terse: an attacker probing the endpoint learns nothing.
    res.status(400).json({ ok: false });
    return;
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ ok: false });
    return;
  }

  // Refund events arrive as payload.refund with payment_id (no order_id), so
  // they are resolved via the payment that was refunded.
  if (event.event === 'refund.processed' || event.event === 'refund.failed') {
    const refundEntity = event.payload?.refund?.entity;
    if (!refundEntity) {
      res.json({ ok: true });
      return;
    }
    const paymentId = typeof refundEntity.payment_id === 'string' ? refundEntity.payment_id : '';
    if (paymentId) {
      const refundedOrder = await Order.findOne({ 'payment.razorpayPaymentId': paymentId });
      if (refundedOrder) {
        const settled = event.event === 'refund.processed' ? 'COMPLETED' : 'FAILED';
        if (refundedOrder.cancellation?.refund?.status !== settled) {
          refundedOrder.set('cancellation.refund.status', settled);
          refundedOrder.set('cancellation.refund.razorpayRefundId', typeof refundEntity.id === 'string' ? refundEntity.id : refundedOrder.cancellation?.refund?.razorpayRefundId ?? '');
          refundedOrder.set('cancellation.refund.completedAt', settled === 'COMPLETED' ? new Date() : refundedOrder.cancellation?.refund?.completedAt ?? null);
          refundedOrder.set('cancellation.refund.failureReason', settled === 'FAILED' ? String(refundEntity.error_description ?? refundEntity.error_reason ?? 'refund failed').slice(0, 300) : '');
          if (settled === 'COMPLETED') refundedOrder.set('payment.status', 'REFUNDED');
          await refundedOrder.save();
        }
        logger.info({ orderNumber: refundedOrder.orderNumber, settled }, 'refund webhook processed');
        res.json({ ok: true });
        return;
      }
    }
    // Unknown refund — acknowledge so Razorpay stops retrying.
    res.json({ ok: true });
    return;
  }

  const entity = event.payload?.payment?.entity;
  const razorpayOrderId = typeof entity?.order_id === 'string' ? entity.order_id : '';
  const razorpayPaymentId = typeof entity?.id === 'string' ? entity.id : '';

  if (!razorpayOrderId) {
    // Acknowledge anything we don't handle so Razorpay stops retrying it.
    res.json({ ok: true });
    return;
  }

  const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
  if (!order) {
    logger.warn({ razorpayOrderId }, 'webhook for unknown order');
    res.json({ ok: true });
    return;
  }

  try {
    switch (event.event) {
      case 'payment.captured':
      case 'order.paid':
        // markPaid is idempotent — the browser callback usually got here first.
        await markPaid(order, razorpayPaymentId);
        break;
      case 'payment.failed':
        await markPaymentFailed(order, String(entity?.error_reason ?? 'payment_failed'));
        break;
      default:
        break;
    }
  } catch (err) {
    logger.error({ err: (err as Error).message, orderNumber: order.orderNumber }, 'webhook processing failed');
    // 500 asks Razorpay to retry, which is what we want for a transient fault.
    res.status(500).json({ ok: false });
    return;
  }

  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* GET /api/payments/config                                                    */
/* -------------------------------------------------------------------------- */

router.get('/config', (_req: Request, res: Response) => {
  res.json({ enabled: razorpayEnabled(), keyId: getPublicKeyId() });
});

export default router;
