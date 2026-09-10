import { Types } from 'mongoose';
import { z } from 'zod';
import { MEASUREMENT_UNITS } from '../domain/constants.js';

/** A syntactically valid Mongo id — checked before any value reaches a query. */
export const objectId = z
  .string()
  .trim()
  .max(24)
  .refine((value) => Types.ObjectId.isValid(value), 'Invalid id');

/**
 * Keys are restricted to the configured measurement-field shape and the map is
 * capped, so the client cannot use this as a free-form data store on the order
 * document.
 */
export const measurementValuesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.number().finite().positive().max(500))
  .refine((values) => Object.keys(values).length <= 30, 'Too many measurement fields');

export const measurementInputSchema = z
  .object({
    unit: z.enum(MEASUREMENT_UNITS).default('inch'),
    values: measurementValuesSchema,
    confirmed: z.boolean().default(false),
  })
  .strict();

const laceColorSchema = z
  .object({
    laceId: objectId,
    colorName: z.string().trim().min(1).max(40),
    colorHex: z.string().trim().max(20).optional(),
  })
  .strict();

const latkanColorSchema = z
  .object({
    latkanId: objectId,
    colorName: z.string().trim().min(1).max(40),
    colorHex: z.string().trim().max(20).optional(),
  })
  .strict();

/**
 * What the browser is allowed to say about a cart line: *choices only*.
 * There is deliberately no price field anywhere in this schema — the server
 * recomputes every amount in services/pricing.ts.
 */
export const cartLineSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    productId: objectId,
    quantity: z.number().int().min(1).max(20),
    colorSlug: z
      .string()
      .trim()
      .max(40)
      .regex(/^[a-z0-9-]*$/)
      .optional(),
    size: z.number().int().min(20).max(60).nullable().optional(),
    fabricId: objectId.nullable().optional(),
    fabricIds: z.array(objectId).min(1).max(6).optional(),
    laceIds: z.array(objectId).max(6).optional(),
    laceColors: z.array(laceColorSchema).max(6).optional(),
    latkanIds: z.array(objectId).max(6).optional(),
    latkanColors: z.array(latkanColorSchema).max(6).optional(),
    measurement: measurementInputSchema.nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const cartLinesSchema = z.array(cartLineSchema).max(30);

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(24)
  .regex(/^[A-Z0-9_-]*$/, 'Coupon code sahi nahi hai.')
  .optional();
