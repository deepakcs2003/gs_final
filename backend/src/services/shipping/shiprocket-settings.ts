import { Setting } from '../../models/analytics.js';
import { env, isProd } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Shiprocket behaviour knobs an operator controls from the admin panel.
 * Auto-create / auto-AWB / auto-pickup all default OFF: nothing touches the
 * live courier lifecycle until the real flow has been verified (user spec
 * STEP 15 "Enable auto"). Tracking sync is informational and ON.
 */
export interface ShiprocketSettings {
  env: 'development' | 'production';
  autoCreate: boolean;
  autoAssignAwb: boolean;
  autoPickup: boolean;
  trackingSync: boolean;
  pickupLocation: string;
}

const DEFAULTS: ShiprocketSettings = {
  env: isProd ? 'production' : 'development',
  autoCreate: false,
  autoAssignAwb: false,
  autoPickup: false,
  trackingSync: true,
  pickupLocation: env.SHIPROCKET_PICKUP_LOCATION,
};

const CACHE_TTL_MS = 60_000;
let cache: { value: ShiprocketSettings; at: number } | null = null;

function coerceBool(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

function coerce(key: keyof ShiprocketSettings, raw: unknown): unknown {
  switch (key) {
    case 'env':
      return raw === 'production' || raw === 'development' ? raw : undefined;
    case 'autoCreate':
    case 'autoAssignAwb':
    case 'autoPickup':
    case 'trackingSync':
      return coerceBool(raw);
    case 'pickupLocation':
      return typeof raw === 'string' && raw.trim() && raw.length <= 60 ? raw.trim() : undefined;
    default:
      return undefined;
  }
}

export async function getShiprocketSettings(): Promise<ShiprocketSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const value = { ...DEFAULTS };
  try {
    const docs = await Setting.find({ key: { $in: Object.keys(DEFAULTS) } })
      .select('key value')
      .lean();

    for (const doc of docs) {
      const key = doc.key as keyof ShiprocketSettings;
      if (!(key in DEFAULTS)) continue;
      const coerced = coerce(key, doc.value);
      if (coerced !== undefined) {
        (value as Record<string, unknown>)[key] = coerced;
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'shiprocket settings lookup failed — using defaults');
  }

  cache = { value, at: Date.now() };
  return value;
}

/** Persists the given subset (undefined keys are skipped, not cleared). */
export async function updateShiprocketSettings(
  patch: Partial<ShiprocketSettings>,
): Promise<ShiprocketSettings> {
  const current = await getShiprocketSettings();
  const next: ShiprocketSettings = { ...current, ...patch };

  for (const [key, raw] of Object.entries(patch)) {
    const coerced = coerce(key as keyof ShiprocketSettings, raw);
    if (coerced === undefined) continue;
    await Setting.updateOne(
      { key },
      { $set: { value: coerced, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  cache = { value: next, at: Date.now() };
  return next;
}

export function invalidateShiprocketSettingsCache(): void {
  cache = null;
}