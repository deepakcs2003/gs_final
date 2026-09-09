import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env, integrations } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceUnavailable } from '../../utils/errors.js';
import type { Currency } from '../../domain/constants.js';

/**
 * Razorpay integration (README §12).
 *
 * Two signatures matter and both are verified with a constant-time comparison:
 *
 *  - Checkout handshake: HMAC-SHA256 of `order_id|payment_id` keyed by the API
 *    secret. Proves the browser's success callback is genuine.
 *  - Webhook: HMAC-SHA256 of the *raw* request body keyed by the webhook
 *    secret. This is the authoritative signal — an order is only marked PAID
 *    from a verified webhook or a verified handshake, never because the client
 *    said so.
 */

let client: Razorpay | null = null;

function getClient(): Razorpay {
  if (!integrations.razorpay) {
    throw serviceUnavailable('Online payment abhi available nahi hai. COD try karein.');
  }
  if (!client) {
    client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return client;
}

export interface CreateRazorpayOrderInput {
  amountMinor: number;
  currency: Currency;
  receipt: string;
  notes?: Record<string, string>;
}

export async function createRazorpayOrder(input: CreateRazorpayOrderInput): Promise<{ id: string; amount: number }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw serviceUnavailable('Payment amount sahi nahi hai.');
  }

  try {
    const order = await getClient().orders.create({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      payment_capture: true,
      notes: input.notes ?? {},
    });
    return { id: order.id, amount: Number(order.amount) };
  } catch (err) {
    // Gateway errors can quote card/customer details — log, never forward.
    logger.error({ err: (err as Error).message }, 'razorpay order creation failed');
    throw serviceUnavailable('Payment start nahi ho paya. Thodi der baad try karein.');
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Verifies the signature Razorpay Checkout hands back in the browser. */
export function verifyCheckoutSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  if (!integrations.razorpay) return false;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
    .digest('hex');
  return safeEqualHex(expected, params.signature);
}

/**
 * Verifies a webhook. `rawBody` must be the exact bytes Razorpay sent — parsing
 * and re-serialising the JSON would change the signature and break this.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!integrations.razorpayWebhook || !signature) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Key id is public by design — it is embedded in the Checkout script. */
export function getPublicKeyId(): string {
  return integrations.razorpay ? env.RAZORPAY_KEY_ID : '';
}

export const razorpayEnabled = () => integrations.razorpay;
