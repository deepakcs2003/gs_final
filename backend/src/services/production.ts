import { Order } from '../models/commerce.js';
import { Tailor } from '../models/tailor.js';
import { getSettings } from './settings.js';
import {
  COMPLEXITY_KEYS,
  type ComplexityKey,
  type TailorSpecialization,
} from '../domain/constants.js';

/**
 * Production planning (order + tailor management).
 *
 * Everything here is *estimation only*. There is deliberately no
 * auto-assignment, no round-robin, no "optimal" picker: a human decides which
 * tailor gets which order (see routes/admin.ts → assign-tailor). This service
 * tells the human two things:
 *
 *  1. total stitching workload (units) in the pipe, including the order being
 *     reviewed/assigned, vs. today's capacity per specialisation;
 *  2. an honest customer-facing delivery range from the production config.
 *
 * Complexity levels map to workload units (editable): simple=1, medium=1.5,
 * designer=2, heavy_designer=3, bridal=4. A tailor covering "simple_blouse"
 * with capacity 2 can absorb 2 simple-blouse units per working day.
 */

export interface ProductionConfig {
  /** ISO weekday numbers the team works (0 = Sunday … 6 = Saturday). */
  workingDays: number[];
  /** YYYY-MM-DD dates the whole team is off. */
  holidays: string[];
  complexityUnits: Record<ComplexityKey, number>;
  packingWorkingDays: number;
  standardShippingDays: number;
  bufferWorkingDays: number;
}

export interface CustomerEstimate {
  stitchingWorkingDays: number;
  packingWorkingDays: number;
  shippingDays: number;
  fromDate: Date;
  toDate: Date;
}

const DEFAULT_COMPLEXITY_UNITS: Record<ComplexityKey, number> = {
  simple: 1,
  medium: 1.5,
  designer: 2,
  heavy_designer: 3,
  bridal: 4,
};

function parseWorkingDays(raw: string): number[] {
  const days = raw.split(',').map((d) => d.trim()).filter(Boolean).map(Number).filter((d) => d >= 0 && d <= 6);
  return new Set(days).size > 0 ? [...new Set(days)].sort() : [1, 2, 3, 4, 5, 6];
}

function parseHolidays(raw: string): string[] {
  return raw.split(',').map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

function parseComplexityUnits(raw: string): Record<ComplexityKey, number> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const units = { ...DEFAULT_COMPLEXITY_UNITS };
    for (const key of COMPLEXITY_KEYS) {
      const n = Number(parsed[key]);
      if (Number.isFinite(n) && n > 0 && n <= 20) units[key] = n;
    }
    return units;
  } catch {
    return { ...DEFAULT_COMPLEXITY_UNITS };
  }
}

function clampInt(raw: number, min: number, max: number): number {
  return Number.isInteger(raw) ? Math.min(Math.max(raw, min), max) : min;
}

export async function getProductionConfig(): Promise<ProductionConfig> {
  const s = await getSettings();
  return {
    workingDays: parseWorkingDays(s.productionWorkingDays),
    holidays: parseHolidays(s.productionHolidays),
    complexityUnits: parseComplexityUnits(s.productionComplexityUnits),
    packingWorkingDays: clampInt(s.productionPackingDays, 0, 14),
    standardShippingDays: clampInt(s.productionStandardShippingDays, 1, 30),
    bufferWorkingDays: clampInt(s.productionBufferDays, 0, 14),
  };
}

/* -------------------------------------------------------------------------- */
/* Complexity detection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic, not AI: reads the product's name, embroidery and tags. The result
 * is a suggestion the admin can override per order (PATCH .../production).
 */
export function detectComplexity(product: {
  name?: string;
  embroidery?: string[];
  tags?: string[];
}): ComplexityKey {
  const needle = [product.name ?? '', ...(product.embroidery ?? []), ...(product.tags ?? [])]
    .join(' ')
    .toLowerCase();

  if (/(bridal|wedding|marriage)/.test(needle)) return 'bridal';
  if (/\bheavy designer\b|heavy/.test(needle)) return 'heavy_designer';
  if (/designer/.test(needle)) return 'designer';
  if (/\bsimple\b/.test(needle)) return 'simple';
  return 'medium';
}

export function complexityLabel(key: ComplexityKey): string {
  const labels: Record<ComplexityKey, string> = {
    simple: 'Simple', medium: 'Medium', designer: 'Designer', heavy_designer: 'Heavy Designer', bridal: 'Bridal',
  };
  return labels[key] ?? key;
}

/** Which tailor specialisation bench an order of this complexity uses. */
export function complexitySpecialization(complexity: ComplexityKey): TailorSpecialization {
  switch (complexity) {
    case 'bridal':
      return 'bridal_blouse';
    case 'designer':
    case 'heavy_designer':
      return 'designer_blouse';
    case 'simple':
    case 'medium':
      return 'simple_blouse';
    default:
      return 'other';
  }
}

/* -------------------------------------------------------------------------- */
/* Workload math                                                               */
/* -------------------------------------------------------------------------- */

export function unitsForOrder(
  items: Array<{ type: string; quantity: number }>,
  complexity: ComplexityKey,
  cfg: ProductionConfig,
): number {
  const unit = cfg.complexityUnits[complexity] ?? 1;
  return items.reduce(
    (sum, item) => (item.type === 'CUSTOMIZE' ? sum + Math.ceil(item.quantity * unit) : sum),
    0,
  );
}

/**
 * Stitching workload already in the pipe: CONFIRMED → PACKED orders with a
 * tailor assigned. `excludeOrderId` lets us add "one more order" without
 * double-counting it.
 */
export async function activeWorkload(
  excludeOrderId?: string,
): Promise<{ units: number; orderCount: number }> {
  const filter: Record<string, unknown> = {
    status: { $in: ['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'] },
    'tailor.status': 'ASSIGNED',
    'tailor.tailorId': { $ne: null },
  };
  if (excludeOrderId) filter._id = { $ne: excludeOrderId };

  const [rows, orderCount] = await Promise.all([
    Order.aggregate<{ units: number }>([
      { $match: filter },
      { $group: { _id: null, units: { $sum: '$production.productionUnits' } } },
    ]),
    Order.countDocuments(filter),
  ]);
  return { units: rows[0]?.units ?? 0, orderCount };
}

/** Combined per-day capacity of ACTIVE tailors who cover `spec`. */
export async function dailyCapacityFor(spec: TailorSpecialization): Promise<number> {
  const tailors = await Tailor.find({
    status: 'ACTIVE',
    specializationCaps: { $elemMatch: { code: spec, capacityPerDay: { $gt: 0 } } },
  }).lean();
  let capacity = 0;
  for (const tailor of tailors) {
    const cap = (tailor.specializationCaps ?? []).find((c) => c.code === spec)?.capacityPerDay ?? 0;
    capacity += cap;
  }
  return capacity;
}

/* -------------------------------------------------------------------------- */
/* Delivery date math                                                          */
/* -------------------------------------------------------------------------- */

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorkingDay(date: Date, cfg: ProductionConfig): boolean {
  if (cfg.holidays.includes(toDateKey(date))) return false;
  return cfg.workingDays.includes(date.getDay());
}

/** Returns a date `count` working days *after* `start` (today is day 0). */
export function addWorkingDays(start: Date, count: number, cfg: ProductionConfig): Date {
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  let remaining = count;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (isWorkingDay(date, cfg)) remaining -= 1;
  }
  return date;
}

function addCalendarDays(start: Date, count: number): Date {
  const date = new Date(start);
  date.setDate(date.getDate() + count);
  return date;
}

/* -------------------------------------------------------------------------- */
/* Public estimate                                                             */
/* -------------------------------------------------------------------------- */

export interface EstimateInput {
  items: Array<{ type: string; quantity: number }>;
  complexity: ComplexityKey;
  /** Per-product admin claim (Product.stitchingDays), used when no capacity. */
  fallbackStitchingDays: number;
  excludeOrderId?: string;
  startDate?: Date;
}

export interface EstimateResult {
  complexity: ComplexityKey;
  productionUnits: number;
  stitchingWorkingDays: number;
  existingUnits: number;
  dailyCapacity: number;
  estimate: CustomerEstimate;
}

/**
 * Human-verified test scenario from the spec:
 * 2 tailors × 2 units/day ⇒ capacity 4; 4 existing assigned + 1 new ⇒
 * workload 5 ⇒ ceil(5/4) = 2 working days of stitching.
 */
export async function computeEstimate(input: EstimateInput): Promise<EstimateResult> {
  const cfg = await getProductionConfig();
  const complexity = input.complexity;
  const productionUnits = unitsForOrder(input.items, complexity, cfg);
  const spec = complexitySpecialization(complexity);

  const existing = await activeWorkload(input.excludeOrderId);
  const dailyCapacity = await dailyCapacityFor(spec);

  const hasCustom = input.items.some((i) => i.type === 'CUSTOMIZE');

  let stitchingWorkingDays = 0;
  if (hasCustom) {
    if (dailyCapacity > 0 && productionUnits > 0) {
      stitchingWorkingDays = Math.max(1, Math.ceil((existing.units + productionUnits) / dailyCapacity));
    } else {
      // No bench configured yet — fall back to the product's own claim.
      stitchingWorkingDays = Math.max(1, input.fallbackStitchingDays || 7);
    }
  }

  const start = input.startDate ? new Date(input.startDate) : new Date();
  const workingDaysUsed =
    stitchingWorkingDays + cfg.packingWorkingDays + (hasCustom ? cfg.bufferWorkingDays : 0);

  const fromDate = addWorkingDays(start, Math.max(1, workingDaysUsed || cfg.packingWorkingDays), cfg);
  const toDate = addCalendarDays(fromDate, cfg.standardShippingDays);

  return {
    complexity,
    productionUnits,
    stitchingWorkingDays,
    existingUnits: existing.units,
    dailyCapacity,
    estimate: {
      stitchingWorkingDays,
      packingWorkingDays: cfg.packingWorkingDays,
      shippingDays: cfg.standardShippingDays,
      fromDate,
      toDate,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Tailor workload (dashboard)                                                 */
/* -------------------------------------------------------------------------- */

export interface TailorWorkloadRow {
  assignedOrders: number;
  assignedUnits: number;
}

/**
 * Per-tailor production load, for the manual assignment picker and the tailor
 * dashboard. Counts CONFIRMED→PACKED orders assigned to this tailor. Orders
 * with no tailor yet are surfaced globally via `pendingWorkload()`.
 */
export async function tailorWorkloads(): Promise<Map<string, TailorWorkloadRow>> {
  const active: Array<{ _id: string | null; units: number; count: number }> = await Order.aggregate([
    { $match: { status: { $in: ['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'] }, 'tailor.tailorId': { $ne: null } } },
    { $group: { _id: '$tailor.tailorId', units: { $sum: '$production.productionUnits' }, count: { $sum: 1 } } },
  ]);
  const map = new Map<string, TailorWorkloadRow>();
  for (const row of active) {
    if (!row._id) continue;
    map.set(String(row._id), { assignedOrders: row.count, assignedUnits: row.units ?? 0 });
  }
  return map;
}

/** Pending (no tailor yet) production across confirmed orders. */
export async function pendingWorkload(): Promise<{ orders: number; units: number }> {
  const rows = await Order.aggregate([
    {
      $match: {
        status: { $in: ['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'] },
        'tailor.status': { $ne: 'ASSIGNED' },
      },
    },
    { $group: { _id: null, units: { $sum: '$production.productionUnits' }, count: { $sum: 1 } } },
  ]);
  const row = rows[0];
  return { orders: row?.count ?? 0, units: row?.units ?? 0 };
}

/** How many CONFIRMED→PACKED orders are waiting on a tailor right now. */
export async function awaitingTailorCount(): Promise<number> {
  return Order.countDocuments({
    status: { $in: ['CONFIRMED'] },
    'tailor.status': { $ne: 'ASSIGNED' },
  });
}