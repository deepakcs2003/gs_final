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
  homeFeedMode: 'SEQUENTIAL' | 'MIXED';
  homeFeedOrder: string;
  homeFeedPageSize: number;

  /** Stitching/production tuning (see services/production.ts). */
  productionWorkingDays: string;
  productionHolidays: string;
  productionComplexityUnits: string;
  productionPackingDays: number;
  productionStandardShippingDays: number;
  productionBufferDays: number;

  /** Lace/latkan colour picker popups (independent per accessory type). */
  laceColorPickerEnabled: boolean;
  latkanColorPickerEnabled: boolean;
}

const DEFAULTS: BusinessSettings = {
  whatsappNumber: env.WHATSAPP_NUMBER,
  callNumber: env.CALL_NUMBER,
  usdRateInr: env.USD_RATE_INR,
  shippingFlatInr: env.SHIPPING_FLAT_INR,
  freeShippingAboveInr: env.FREE_SHIPPING_ABOVE_INR,
  measurementInstructionVersion: 'v1',
  homeFeedMode: 'SEQUENTIAL',
  homeFeedOrder: 'CUSTOMIZE,READY_MADE,SHOWCASE',
  homeFeedPageSize: 12,

  productionWorkingDays: '1,2,3,4,5,6',
  productionHolidays: '',
  productionComplexityUnits: '{"simple":1,"medium":1.5,"designer":2,"heavy_designer":3,"bridal":4}',
  productionPackingDays: 1,
  productionStandardShippingDays: 4,
  productionBufferDays: 1,

  laceColorPickerEnabled: false,
  latkanColorPickerEnabled: false,
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
    case 'homeFeedMode':
      return raw === 'SEQUENTIAL' || raw === 'MIXED' ? raw : undefined;
    case 'homeFeedOrder': {
      if (typeof raw !== 'string') return undefined;
      const types = raw.split(',').map((value) => value.trim()).filter(Boolean);
      const allowed = new Set(['CUSTOMIZE', 'READY_MADE', 'SHOWCASE']);
      return types.length >= 1 && types.length <= 3 && new Set(types).size === types.length && types.every((type) => allowed.has(type))
        ? types.join(',')
        : undefined;
    }
    case 'homeFeedPageSize': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 6 && n <= 30 ? n : undefined;
    }
    case 'productionWorkingDays': {
      if (typeof raw !== 'string') return undefined;
      const days = raw.split(',').map((d) => d.trim()).filter(Boolean);
      const valid = days.every((d) => /^[0-6]$/.test(d));
      return valid && days.length >= 1 ? days.map(Number).join(',') : undefined;
    }
    case 'productionHolidays': {
      if (typeof raw !== 'string' || raw.length > 2000) return undefined;
      const parts = raw.split(',').map((d) => d.trim()).filter(Boolean);
      return parts.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? parts.join(',') : undefined;
    }
    case 'productionComplexityUnits': {
      if (typeof raw !== 'string') return undefined;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const keys = ['simple', 'medium', 'designer', 'heavy_designer', 'bridal'];
        const valid = keys.every((k) => typeof parsed[k] === 'number' && Number.isFinite(parsed[k]) && parsed[k] > 0 && parsed[k] <= 20);
        return valid ? JSON.stringify({
          simple: parsed.simple, medium: parsed.medium, designer: parsed.designer,
          heavy_designer: parsed.heavy_designer, bridal: parsed.bridal,
        }) : undefined;
      } catch {
        return undefined;
      }
    }
    case 'productionPackingDays':
    case 'productionStandardShippingDays':
    case 'productionBufferDays': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n <= 30 ? n : undefined;
    }
    case 'laceColorPickerEnabled':
    case 'latkanColorPickerEnabled':
      return raw === true || raw === 'true' || raw === 1 || raw === '1'
        ? true
        : raw === false || raw === 'false' || raw === 0 || raw === '0'
          ? false
          : undefined;
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
