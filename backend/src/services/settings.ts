import { Setting } from '../models/analytics.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Business values the shop owner can change without a deploy (README §24, §32).
 * Env supplies the boot-time default; the database overrides it once an admin
 * edits the value. Cached briefly so the storefront doesn't query per request.
 */
export interface BusinessSettings {
  whatsappNumber: string;
  callNumber: string;
  usdRateInr: number;
  shippingFlatInr: number;
  freeShippingAboveInr: number;
  measurementInstructionVersion: string;
}

const DEFAULTS: BusinessSettings = {
  whatsappNumber: env.WHATSAPP_NUMBER,
  callNumber: env.CALL_NUMBER,
  usdRateInr: env.USD_RATE_INR,
  shippingFlatInr: env.SHIPPING_FLAT_INR,
  freeShippingAboveInr: env.FREE_SHIPPING_ABOVE_INR,
  measurementInstructionVersion: 'v1',
};

const CACHE_TTL_MS = 60_000;
let cache: { value: BusinessSettings; at: number } | null = null;

/** Values from the DB are attacker-irrelevant but operator-editable, so each is
 *  still range-checked before use — a mistyped FX rate must not price at zero. */
function coerce(key: keyof BusinessSettings, raw: unknown): unknown {
  switch (key) {
    case 'whatsappNumber':
    case 'callNumber':
      return typeof raw === 'string' && /^\d{10,15}$/.test(raw) ? raw : undefined;
    case 'usdRateInr': {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 && n < 1000 ? n : undefined;
    }
    case 'shippingFlatInr':
    case 'freeShippingAboveInr': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : undefined;
    }
    case 'measurementInstructionVersion':
      return typeof raw === 'string' && /^v\d{1,3}$/.test(raw) ? raw : undefined;
    default:
      return undefined;
  }
}

export async function getSettings(): Promise<BusinessSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const value = { ...DEFAULTS };
  try {
    const docs = await Setting.find({ key: { $in: Object.keys(DEFAULTS) } })
      .select('key value')
      .lean();

    for (const doc of docs) {
      const key = doc.key as keyof BusinessSettings;
      if (!(key in DEFAULTS)) continue;
      const coerced = coerce(key, doc.value);
      if (coerced !== undefined) {
        (value as Record<string, unknown>)[key] = coerced;
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'settings lookup failed — using defaults');
  }

  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
