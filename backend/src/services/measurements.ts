import { MeasurementField, type MeasurementFieldDoc } from '../models/user.js';
import { CM_PER_INCH, type MeasurementUnit } from '../domain/constants.js';

/**
 * Measurement handling (README §18–22).
 *
 * Everything is stored in inches — the unit tailors actually work in — and the
 * customer's chosen unit is only a display concern. Validation is server-side
 * because a wrong measurement is expensive: it produces a blouse that does not
 * fit and cannot be resold.
 */

export function toInches(value: number, unit: MeasurementUnit): number {
  const inches = unit === 'cm' ? value / CM_PER_INCH : value;
  // Half-inch precision matches what a tailor's tape can actually read.
  return Math.round(inches * 2) / 2;
}

export function fromInches(inches: number, unit: MeasurementUnit): number {
  if (unit === 'cm') return Math.round(inches * CM_PER_INCH * 2) / 2;
  return inches;
}

let fieldCache: { fields: MeasurementFieldDoc[]; at: number } | null = null;
const FIELD_CACHE_TTL_MS = 60_000;

export async function getActiveMeasurementFields(): Promise<MeasurementFieldDoc[]> {
  if (fieldCache && Date.now() - fieldCache.at < FIELD_CACHE_TTL_MS) return fieldCache.fields;
  const fields = (await MeasurementField.find({ isActive: true }).sort({ order: 1 }).lean()) as MeasurementFieldDoc[];
  fieldCache = { fields, at: Date.now() };
  return fields;
}

export function invalidateMeasurementFieldCache(): void {
  fieldCache = null;
}

export interface MeasurementInput {
  unit: MeasurementUnit;
  values: Record<string, number>;
  confirmed?: boolean;
}

export interface MeasurementValidationResult {
  ok: boolean;
  /** Field key -> Hinglish message, ready to render next to the input. */
  errors: Record<string, string>;
  /** Normalised to inches, unknown keys dropped. */
  valuesInInches: Record<string, number>;
}

/**
 * Rejects impossible measurements (README §22: "500 inch" must not pass) and
 * silently drops any key that is not a configured field — that is also what
 * stops a client from stuffing arbitrary data into the order document.
 */
export async function validateMeasurements(input: MeasurementInput): Promise<MeasurementValidationResult> {
  const fields = await getActiveMeasurementFields();
  const errors: Record<string, string> = {};
  const valuesInInches: Record<string, number> = {};

  for (const field of fields) {
    const raw = input.values[field.key];

    if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
      if (field.required) errors[field.key] = `${field.label} bharna zaroori hai.`;
      continue;
    }

    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      errors[field.key] = 'Sahi measurement likhein.';
      continue;
    }

    const inches = toInches(numeric, input.unit);
    if (inches < field.minInch || inches > field.maxInch) {
      const min = fromInches(field.minInch, input.unit);
      const max = fromInches(field.maxInch, input.unit);
      errors[field.key] = `${field.label} ${min}–${max} ${input.unit} ke beech hona chahiye.`;
      continue;
    }

    valuesInInches[field.key] = inches;
  }

  return { ok: Object.keys(errors).length === 0, errors, valuesInInches };
}

/** README §74 — the customer must tick the confirmation before paying. */
export function isMeasurementReady(measurement: { confirmed?: boolean; values?: unknown } | null | undefined): boolean {
  if (!measurement) return false;
  if (!measurement.confirmed) return false;
  const values = measurement.values;
  if (values instanceof Map) return values.size > 0;
  return Boolean(values && typeof values === 'object' && Object.keys(values as object).length > 0);
}
