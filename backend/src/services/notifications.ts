import { Order } from '../models/commerce.js';
import { logger } from '../utils/logger.js';
import { notifyOrderEvent } from './whatsapp/notify.js';
import { maskMobile } from './otp.js';

/**
 * Customer notifications for order lifecycle events.
 *
 * Delivery is fire-and-forget and ASYNC: the WhatsApp queue (never this HTTP
 * request) delivers the message, so a failed WhatsApp API cannot roll back a
 * successful refund or cancellation. Callers record the outcome and move on.
 * SMS/MSG91 are gone — every customer message is an approved WhatsApp template.
 */

export interface NotificationOutcome {
  ok: boolean;
  message: string;
  provider: string;
}

/**
 * Enqueues the cancellation/refund WhatsApp message for an order. `refundText`
 * is accepted for backwards compatibility with the admin route but the exact
 * refund amount is recomputed from the order itself.
 */
export async function notifyOrderCancellation(input: {
  mobile: string;
  orderNumber: string;
  reason: string;
  refundText: string;
}): Promise<NotificationOutcome> {
  const order = await Order.findOne({ orderNumber: input.orderNumber }).exec();
  if (!order) {
    logger.warn({ orderNumber: input.orderNumber }, 'cancellation notify: order not found');
    return { ok: false, message: 'Order nahi mila — notification skip.', provider: 'whatsapp' };
  }

  const paymentStatus = order.payment?.status;
  const refundMinor =
    paymentStatus === 'PAID'
      ? order.amounts?.totalMinor ?? 0
      : paymentStatus === 'COD_ADVANCE_PAID'
        ? order.amounts?.codAdvanceMinor ?? 0
        : 0;

  const outcome = await notifyOrderEvent(order, 'ORDER_CANCELLED', { refundMinor });

  if (outcome.ok) {
    return {
      ok: true,
      message: 'WhatsApp cancellation message queue mein daal diya gaya hai.',
      provider: 'whatsapp',
    };
  }
  logger.warn(
    { orderNumber: input.orderNumber, reason: outcome.reason },
    'cancellation whatsapp notify skipped',
  );
  return {
    ok: false,
    message: `WhatsApp skip: ${outcome.reason ?? 'unknown'}`,
    provider: 'whatsapp',
  };
}

export { maskMobile };