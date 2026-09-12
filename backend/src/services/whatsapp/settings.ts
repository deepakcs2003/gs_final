import { Setting } from '../../models/analytics.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * WhatsApp behaviour knobs an operator controls from Admin → Communications.
 * Env supplies the boot-time default (mode, phone number id...); the database
 * overrides the editable values once an admin saves them.
 *
 * Cost discipline is baked in: every order-notification event has its own
 * toggle (default ON only for the spec's minimum set), and the marketing
 * cooldown defaults to 7 days so a customer is never blasted repeatedly.
 */
export interface WhatsAppSettings {
  enabled: boolean;
  mode: 'test' | 'production';
  notifyConfirmed: boolean;
  notifyShipped: boolean;
  notifyOutForDelivery: boolean;
  notifyDelivered: boolean;
  notifyCancelled: boolean;
  /** Days between marketing campaigns to the same customer. */
  marketingCooldownDays: number;
  /** Admin-configurable average cost per message for campaign previews. */
  costPerMessageInr: number;
  /** Sunny-count of the free tier — used only as a headline in the admin UI. */
  dailyQuota: number;
  /** Website-first strategy: order messages carry a tracking link. */
  addOrderLink: boolean;
}

const DEFAULTS: WhatsAppSettings = {
  enabled: true,
  mode: env.WHATSAPP_MODE,
  notifyConfirmed: true,
  notifyShipped: true,
  notifyOutForDelivery: true,
  notifyDelivered: true,
  notifyCancelled: true,
  marketingCooldownDays: 7,
  costPerMessageInr: 0.9,
  dailyQuota: 1000,
  addOrderLink: true,
};

const CACHE_TTL_MS = 60_000;
let cache: { value: WhatsAppSettings; at: number } | null = null;

function coerce(key: keyof WhatsAppSettings, raw: unknown): unknown {
  switch (key) {
    case 'enabled':
    case 'notifyConfirmed':
    case 'notifyShipped':
    case 'notifyOutForDelivery':
    case 'notifyDelivered':
    case 'notifyCancelled':
    case 'addOrderLink':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'mode':
      return raw === 'test' || raw === 'production' ? raw : undefined;
    case 'marketingCooldownDays': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 90 ? n : undefined;
    }
    case 'costPerMessageInr': {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
    }
    case 'dailyQuota': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : undefined;
    }
    default:
      return undefined;
  }
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const value = { ...DEFAULTS };
  try {
    const docs = await Setting.find({ key: { $in: Object.keys(DEFAULTS) } })
      .select('key value')
      .lean();

    for (const doc of docs) {
      const key = doc.key as keyof WhatsAppSettings;
      if (!(key in DEFAULTS)) continue;
      const coerced = coerce(key, doc.value);
      if (coerced !== undefined) {
        (value as Record<string, unknown>)[key] = coerced;
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'whatsapp settings lookup failed — using defaults');
  }

  cache = { value, at: Date.now() };
  return value;
}

/**
 * Persists the given subset (undefined keys are skipped, not cleared).
 * `mode` is deliberately NOT settable here — test→production is an env-only
 * switch (see backend/.env.example).
 */
export async function updateWhatsAppSettings(
  patch: Partial<Omit<WhatsAppSettings, 'mode'>>,
): Promise<WhatsAppSettings> {
  const current = await getWhatsAppSettings();
  const next: WhatsAppSettings = { ...current, ...patch };

  for (const [key, raw] of Object.entries(patch)) {
    const coerced = coerce(key as keyof WhatsAppSettings, raw);
    if (coerced === undefined) continue;
    await Setting.updateOne({ key }, { $set: { value: coerced, updatedAt: new Date() } }, { upsert: true });
  }

  cache = { value: next, at: Date.now() };
  return next;
}

export function invalidateWhatsAppSettingsCache(): void {
  cache = null;
}