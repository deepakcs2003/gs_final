import { env } from '../../config/env.js';
import { User } from '../../models/user.js';
import type { OrderDoc } from '../../models/commerce.js';
import type { OrderNotificationType } from './constants.js';
import { getWhatsAppSettings } from './settings.js';
import { enqueueWhatsApp } from './queue.js';
import { bodyParameters, buildComponents } from './templates.js';

/**
 * Order + OTP notification orchestration — the only place the app decides
 * WHETHER a customer gets a message. Every decision is cheap and fire-and-forget:
 * return quickly, enqueue the work, never block the caller on Meta.
 */

const inr = (minor: number): string => `Rs${(minor / 100).toLocaleString('en-IN')}`;

function firstName(name?: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first || 'Friend';
}

/** Website-first strategy: the short WhatsApp text + a tracking link. */
function orderTrackUrl(orderNumber: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/order/${encodeURIComponent(orderNumber)}`;
}

const EVENT_TOGGLE: Record<OrderNotificationType, keyof Omit<import('./settings.js').WhatsAppSettings, 'mode'>> = {
  ORDER_CONFIRMED: 'notifyConfirmed',
  ORDER_SHIPPED: 'notifyShipped',
  ORDER_OUT_FOR_DELIVERY: 'notifyOutForDelivery',
  ORDER_DELIVERED: 'notifyDelivered',
  ORDER_CANCELLED: 'notifyCancelled',
};

const EVENT_TEMPLATE: Record<OrderNotificationType, string> = {
  ORDER_CONFIRMED: 'order_confirmed',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_OUT_FOR_DELIVERY: 'order_out_for_delivery',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled_refund',
};

function paymentNote(order: OrderDoc): string {
  const method = order.payment?.method;
  const status = order.payment?.status;
  if (method === 'COD') {
    const advance = order.amounts?.codAdvanceMinor ?? 0;
    if (status === 'COD_ADVANCE_PAID') return `Advance ${inr(advance)} mil chuka; baaki Cash on Delivery.`;
    if (advance > 0) return `Advance ${inr(advance)} aur baaki Cash on Delivery.`;
    return 'Payment Cash on Delivery par hoga.';
  }
  if (method === 'RAZORPAY' && status === 'PAID') return 'Payment ho gaya. Thank you!';
  return 'Payment pending hai — jald confirm hoga.';
}

/**
 * Builds the template params for an order event. Order of {{1}}..{{n}} must
 * match the approved body in Meta exactly (see services/whatsapp/templates.ts).
 */
function orderParams(order: OrderDoc, type: OrderNotificationType, extra?: { refundMinor?: number }): Array<string> {
  const name = firstName(order.contact?.name);
  const orderNumber = order.orderNumber;
  const trackUrl = orderTrackUrl(orderNumber);
  switch (type) {
    case 'ORDER_CONFIRMED':
      return [name, orderNumber, inr(order.amounts?.totalMinor ?? 0), paymentNote(order)];
    case 'ORDER_SHIPPED':
      return [name, orderNumber, order.shipping?.awb || 'AWB jald update hoga'];
    case 'ORDER_OUT_FOR_DELIVERY':
      return [name, orderNumber];
    case 'ORDER_DELIVERED':
      return [name, orderNumber];
    case 'ORDER_CANCELLED': {
      const refund = extra?.refundMinor ? `Paisa ${inr(extra.refundMinor)} wapas kiya ja raha hai.` : 'Koi payment pending nahi thi.';
      return [name, orderNumber, refund];
    }
  }
}

const TAGS_NEEDING_BUTTON: OrderNotificationType[] = ['ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_CANCELLED'];

export interface NotifyOutcome {
  ok: boolean;
  queued?: boolean;
  reason?: string;
  messageLogId?: string;
}

/**
 * Enqueue one WhatsApp message for an order lifecycle event. Used by the order
 * confirm/cancel admin actions and by the shipping tracking update. Duplicate
 * calls for the same order+event are rejected by the dedupeKey index.
 */
export async function notifyOrderEvent(
  order: OrderDoc,
  type: OrderNotificationType,
  extra?: { refundMinor?: number },
): Promise<NotifyOutcome> {
  const toggle = EVENT_TOGGLE[type];
  const settings = await getWhatsAppSettings();
  const enabledForEvent = settings[toggle] as boolean | undefined;
  if (!enabledForEvent) return { ok: false, reason: `${type} notification OFF` };

  const mobile = (order.contact?.mobile ?? '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(mobile)) return { ok: false, reason: 'valid mobile nahi hai' };

  // Customer-level control: users can turn off transactional messages.
  if (order.user) {
    const user = await User.findById(order.user).select('whatsappOptIn whatsappTransactionalOptIn').lean();
    if (user?.whatsappOptIn === false || user?.whatsappTransactionalOptIn === false) return { ok: false, reason: 'customer opted out' };
  }

  const templateName = EVENT_TEMPLATE[type];
  const params = orderParams(order, type, extra);
  const needsButton = TAGS_NEEDING_BUTTON.includes(type);
  const components = needsButton
    ? buildComponents(params, orderTrackUrl(order.orderNumber))
    : [{ type: 'BODY', parameters: bodyParameters(params) }];

  const result = await enqueueWhatsApp({
    mobile,
    templateName,
    category: 'UTILITY',
    type,
    orderId: String(order._id),
    customerId: order.user ? String(order.user) : undefined,
    dedupeKey: `order:${String(order._id)}:${type}`,
    components,
  });

  return { ok: result.queued, queued: result.queued, reason: result.reason, messageLogId: result.messageLogId };
}

/**
 * OTP delivery used by the OTP-provider bridge in services/otp. Throws when the
 * message could not be queued so the auth route can answer with a clean error.
 */
export async function sendOtpViaWhatsApp(mobile: string, code: string): Promise<void> {
  const components = buildComponents([code], undefined, code);
  const result = await enqueueWhatsApp({
    mobile: mobile.replace(/^\+/, ''),
    templateName: 'guddi_otp',
    category: 'AUTHENTICATION',
    type: 'OTP',
    dedupeKey: `otp:${mobile.replace(/^\+/, '').replace(/\D/g, '')}:${code}`,
    components,
  });
  if (!result.queued) {
    throw new Error(`WhatsApp OTP queue fail: ${result.reason ?? 'unknown'}`);
  }
}