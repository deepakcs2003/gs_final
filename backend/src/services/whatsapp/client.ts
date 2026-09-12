import crypto from 'node:crypto';
import axios from 'axios';
import { env, integrations, whatsapp } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Direct Meta WhatsApp Business Cloud API client — no MSG91, no third-party BSP.
 * A single axios POST per message; text, templates, OTP, order updates and
 * campaigns all go through this file. Credentials come from the WHATSAPP_MODE-
 * scoped config in config/env.ts (TEST_* or PRODUCTION_*, never mixed).
 *
 * Guardrails:
 *  - TEST MODE (default): only the numbers in WHATSAPP_TEST_NUMBERS (plus
 *    ADMIN_MOBILE) are reachable app-side; Meta additionally enforces its own
 *    test-recipient allow-list. Switch via WHATSAPP_MODE=production.
 *  - No secrets are ever logged — Meta errors are surfaced with code/message
 *    but the access token, app secret and verify token never appear.
 */

export type WaMessageType = 'text' | 'template';

export interface WaSendSuccess {
  ok: true;
  wamid: string;
  transport: 'meta' | 'console';
  mode: 'test' | 'production';
}

export interface WaSendFailure {
  ok: false;
  code: 'RATE_LIMITED' | 'AUTH' | 'PERMANENT' | 'TEST_MODE_BLOCKED' | 'NETWORK';
  message: string;
  retryable: boolean;
  /** Meta's structured error when available, sanitised (no tokens). */
  meta?: { code?: number; subcode?: number; type?: string; fbtrace_id?: string };
}

export type WaSendResult = WaSendSuccess | WaSendFailure;

/** Logs/errors never print more than the last 4 digits of a phone number. */
export function maskMobile(mobile: string): string {
  if (mobile.length <= 4) return '****';
  return `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}`;
}

/** Numbers that are allowed to receive messages while WHATSAPP_MODE=test. */
function allowedTestNumbers(): Set<string> {
  const numbers = [
    ...whatsapp.testNumbers.map((n) => n.trim()).filter(Boolean),
    ...(env.ADMIN_MOBILE ? [env.ADMIN_MOBILE] : []),
  ];
  return new Set(numbers.map((n) => n.replace(/^\+/, '')));
}

interface MetaSendResponse {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string };
  messages?: Array<{ id?: string }>;
}

/**
 * Low-level POST to the Graph messages endpoint with the ACTIVE credentials.
 * Never called directly by routes outside this file.
 */
async function postMessage(body: Record<string, unknown>): Promise<WaSendResult> {
  // Dev fallback when nothing is configured outside production: log the
  // would-be message so the pipeline (queue, logs, UI) is testable offline.
  if (!integrations.whatsapp && env.NODE_ENV !== 'production') {
    logger.info(
      { body: sanitiseLog(body) },
      '[whatsapp-console] would send (no credentials configured)',
    );
    return {
      ok: true,
      wamid: `console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      transport: 'console',
      mode: whatsapp.mode,
    };
  }
  if (!integrations.whatsapp) {
    return {
      ok: false,
      code: 'AUTH',
      message: 'WhatsApp credentials configured nahi hain — .env mein WHATSAPP_TEST_*/PRODUCTION_* check karein.',
      retryable: false,
    };
  }

  try {
    const response = await axios.post<MetaSendResponse>(
      `https://graph.facebook.com/${whatsapp.apiVersion}/${whatsapp.phoneNumberId}/messages`,
      body,
      {
        headers: { Authorization: `Bearer ${whatsapp.accessToken}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
        maxRedirects: 0,
        // 4xx/5xx bodies carry Meta's structured error — read them instead of throwing.
        validateStatus: (status) => status < 500,
      },
    );

    if (response.status !== 200) {
      const error = response.data?.error;
      const message = error?.message ?? `Meta API error (HTTP ${response.status})`;
      // 130429 = rate limited; 131047 = temporary unbounded; 131026 = out of capacity;
      // 190 = permission/invalid token; 100 = parameter problem (unknown template, etc.).
      const httpStatus = response.status;
      const metaCode = error?.code ?? 0;
      const rateLimited = httpStatus === 429 || metaCode === 130429 || metaCode === 131047 || metaCode === 131026;
      const authError = httpStatus === 401 || httpStatus === 403 || metaCode === 190;
      return {
        ok: false,
        code: authError ? 'AUTH' : rateLimited ? 'RATE_LIMITED' : 'PERMANENT',
        message: message.slice(0, 300),
        retryable: rateLimited,
        meta: {
          code: metaCode,
          subcode: error?.error_subcode,
          type: error?.type,
          fbtrace_id: error?.fbtrace_id,
        },
      };
    }

    const data = response.data;
    const wamid = data.messages?.[0]?.id ?? '';
    if (!wamid) {
      return { ok: false, code: 'PERMANENT', message: 'Meta response mein message id nahi mili.', retryable: false };
    }
    return { ok: true, wamid, transport: 'meta', mode: whatsapp.mode };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown network error';
    logger.warn({ err: message }, 'whatsapp send failed (network/timeout)');
    return { ok: false, code: 'NETWORK', message: message.slice(0, 300), retryable: true };
  }
}

/** Removes anything that could carry a secret from console-fallback logs. */
function sanitiseLog(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, to: maskMobile(String(body.to ?? '')) };
}

/** Sends a free-form text message (only valid inside a 24h customer window). */
export async function sendTextMessage(
  mobile: string,
  text: string,
): Promise<WaSendResult> {
  if (!text.trim()) return { ok: false, code: 'PERMANENT', message: 'Text khaali hai.', retryable: false };
  if (whatsapp.mode === 'test' && !allowedTestNumbers().has(mobile.replace(/^\+/, ''))) {
    const message =
      'WhatsApp TEST MODE: yah number allow nahi hai. WHATSAPP_TEST_NUMBERS mein add karein ya WHATSAPP_MODE=production karein.';
    logger.warn({ mobile: maskMobile(mobile) }, message);
    return { ok: false, code: 'TEST_MODE_BLOCKED', message, retryable: false };
  }
  return postMessage({
    messaging_product: 'whatsapp',
    to: mobile.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body: text.slice(0, 4096) },
  });
}

/** Sends an approved template message (required outside the 24h window). */
export async function sendTemplateMessage(input: {
  mobile: string;
  templateName: string;
  language?: string;
  components?: Array<Record<string, unknown>>;
}): Promise<WaSendResult> {
  const language = input.language ?? 'en_US';
  const components = input.components ?? [];

  if (whatsapp.mode === 'test' && !allowedTestNumbers().has(input.mobile.replace(/^\+/, ''))) {
    const message =
      'WhatsApp TEST MODE: yah number allow nahi hai. WHATSAPP_TEST_NUMBERS mein add karein ya WHATSAPP_MODE=production karein.';
    logger.warn({ mobile: maskMobile(input.mobile) }, message);
    return { ok: false, code: 'TEST_MODE_BLOCKED', message, retryable: false };
  }

  return postMessage({
    messaging_product: 'whatsapp',
    to: input.mobile.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  });
}

/** Backwards-compatible alias used by the queue worker. */
export const sendWaTemplate = sendTemplateMessage;

/**
 * Verifies the X-Hub-Signature-256 header on webhook deliveries. The raw body
 * bytes are HMAC-SHA256'd with WHATSAPP_APP_SECRET; only Meta holds that key.
 *
 * In test mode an unset app secret does NOT block signature checks (it simply
 * rejects), so local webhook testing can use a crafted header; production mode
 * REQUIRES the app secret (enforced at boot in config/env.ts).
 */
export function verifyWaWebhookSignature(rawBody: Buffer, header: string): boolean {
  if (!whatsapp.appSecret || !header) return false;
  const expected = header.replace(/^sha256=/, '');
  const digest = crypto.createHmac('sha256', whatsapp.appSecret).update(rawBody).digest('hex');
  return expected.length > 0 && expected === digest;
}