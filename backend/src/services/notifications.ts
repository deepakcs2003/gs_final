import { getSmsProvider, maskMobile } from './sms/index.js';
import { logger } from '../utils/logger.js';

/**
 * Best-effort customer notifications for order lifecycle events.
 *
 * Delivery is fire-and-forget: a failed SMS must never roll back a successful
 * refund or cancellation. Callers record the outcome (order.cancellation
 * notification fields) and move on.
 */

export interface NotificationOutcome {
  ok: boolean;
  message: string;
  provider: string;
}

function inrLabel(minor: number): string {
  return `Rs${(minor / 100).toLocaleString('en-IN')}`;
}

/**
 * Sends a cancellation / refund sms to the order's mobile. `refundText` is
 * empty when no refund applies (e.g. a pending/unpaid order).
 */
export async function notifyOrderCancellation(input: {
  mobile: string;
  orderNumber: string;
  reason: string;
  refundText: string;
}): Promise<NotificationOutcome> {
  const message = [
    `Guddi Silai: aapka order ${input.orderNumber} cancel ho gaya hai.`,
    input.reason ? `Reason: ${input.reason}` : '',
    input.refundText ? `Paisa ${input.refundText} wapas kiya ja raha hai.` : 'Koi payment pending nahi thi.',
    'Sawaal ke liye hamari customer care se sampark karein.',
  ].filter(Boolean).join(' ');

  const provider = getSmsProvider();
  try {
    await provider.sendMessage(input.mobile, message);
    return { ok: true, message: `SMS bheja: ${message.slice(0, 120)}`, provider: provider.name };
  } catch (err) {
    const reason = (err as Error).message?.slice(0, 200) ?? 'unknown';
    logger.warn({ err: (err as Error).message, mobile: maskMobile(input.mobile), orderNumber: input.orderNumber }, 'cancellation sms failed');
    return { ok: false, message: `SMS fail: ${reason}`, provider: provider.name };
  }
}

export { maskMobile };