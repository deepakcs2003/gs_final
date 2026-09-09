import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { MeasurementProfile } from '../models/user.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { getActiveMeasurementFields, fromInches, validateMeasurements } from '../services/measurements.js';
import { getSettings } from '../services/settings.js';
import { measurementInputSchema, measurementValuesSchema, objectId } from '../schemas/cart.js';
import { notFound } from '../utils/errors.js';
import { MEASUREMENT_UNITS } from '../domain/constants.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* GET /api/measurements/fields — the admin-configured form (README §19–20)    */
/* -------------------------------------------------------------------------- */

router.get('/fields', readLimiter, async (req: Request, res: Response) => {
  const [fields, settings] = await Promise.all([getActiveMeasurementFields(), getSettings()]);
  const unit = req.query.unit === 'cm' ? 'cm' : 'inch';

  res.json({
    unit,
    instructionVersion: settings.measurementInstructionVersion,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      labelHi: field.labelHi ?? '',
      instruction: field.instruction ?? '',
      gifUrl: field.gifUrl ?? '',
      imageUrl: field.imageUrl ?? '',
      required: field.required,
      // Bounds are shown in whichever unit the customer is working in, so the
      // hint under the input always matches what they are typing.
      min: fromInches(field.minInch, unit),
      max: fromInches(field.maxInch, unit),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/measurements/validate  (README §22)                               */
/* -------------------------------------------------------------------------- */

/**
 * The form validates as you type in the browser too, but that is only a
 * convenience. This endpoint is the boundary that actually decides whether a
 * measurement is usable, because client-side checks can always be bypassed.
 */
router.post(
  '/validate',
  writeLimiter,
  validate({ body: z.object({ measurement: measurementInputSchema }).strict() }),
  async (req: Request, res: Response) => {
    const { measurement } = (req as Request & { validated: { body: { measurement: z.infer<typeof measurementInputSchema> } } })
      .validated.body;

    const result = await validateMeasurements(measurement);
    res.json({ ok: result.ok, errors: result.errors });
  },
);

/* -------------------------------------------------------------------------- */
/* Saved profiles — signed-in customers only (README §23)                      */
/* -------------------------------------------------------------------------- */

router.get('/profiles', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const unit = req.query.unit === 'cm' ? 'cm' : 'inch';

  const profiles = await MeasurementProfile.find({ user: req.auth!.userId })
    .sort({ isDefault: -1, updatedAt: -1 })
    .lean();

  res.json({
    items: profiles.map((profile) => ({
      id: String(profile._id),
      name: profile.name,
      isDefault: profile.isDefault,
      unit,
      instructionVersion: profile.instructionVersion,
      // Stored in inches; presented in the requested unit.
      values: Object.fromEntries(
        Object.entries((profile.values ?? {}) as Record<string, number>).map(([key, inches]) => [
          key,
          fromInches(inches, unit),
        ]),
      ),
      updatedAt: profile.updatedAt,
    })),
  });
});

const saveProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(40).default('Default Profile'),
    unit: z.enum(MEASUREMENT_UNITS).default('inch'),
    values: measurementValuesSchema,
    isDefault: z.boolean().default(false),
  })
  .strict();

const MAX_PROFILES = 5;

router.post(
  '/profiles',
  requireAuth,
  writeLimiter,
  validate({ body: saveProfileSchema }),
  async (req: Request, res: Response) => {
    const body = (req as Request & { validated: { body: z.infer<typeof saveProfileSchema> } }).validated.body;

    const validation = await validateMeasurements({ unit: body.unit, values: body.values, confirmed: true });
    if (!validation.ok) {
      res.status(400).json({
        error: { code: 'INVALID_MEASUREMENT', message: 'Kuch measurement sahi nahi hai.', fields: validation.errors },
      });
      return;
    }

    const count = await MeasurementProfile.countDocuments({ user: req.auth!.userId });
    if (count >= MAX_PROFILES) {
      res.status(409).json({
        error: { code: 'LIMIT_REACHED', message: `Zyada se zyada ${MAX_PROFILES} measurement profile save ho sakte hain.` },
      });
      return;
    }

    const settings = await getSettings();

    if (body.isDefault) {
      await MeasurementProfile.updateMany({ user: req.auth!.userId }, { $set: { isDefault: false } });
    }

    const profile = await MeasurementProfile.create({
      user: req.auth!.userId,
      name: body.name,
      unit: body.unit,
      values: validation.valuesInInches,
      isDefault: body.isDefault || count === 0,
      instructionVersion: settings.measurementInstructionVersion,
    });

    res.status(201).json({ id: String(profile._id), ok: true });
  },
);

const profileParams = z.object({ id: objectId }).strict();

router.patch(
  '/profiles/:id',
  requireAuth,
  writeLimiter,
  validate({ params: profileParams, body: saveProfileSchema.partial() }),
  async (req: Request, res: Response) => {
    const { params, body } = (req as Request & {
      validated: { params: { id: string }; body: Partial<z.infer<typeof saveProfileSchema>> };
    }).validated;

    // Ownership is part of the filter, not a check afterwards — that is what
    // makes guessing another customer's profile id useless.
    const profile = await MeasurementProfile.findOne({ _id: params.id, user: req.auth!.userId });
    if (!profile) throw notFound('Yeh measurement profile nahi mila.');

    if (body.values) {
      const unit = body.unit ?? (profile.unit as 'inch' | 'cm');
      const validation = await validateMeasurements({ unit, values: body.values, confirmed: true });
      if (!validation.ok) {
        res.status(400).json({
          error: { code: 'INVALID_MEASUREMENT', message: 'Kuch measurement sahi nahi hai.', fields: validation.errors },
        });
        return;
      }
      profile.values = new Map(Object.entries(validation.valuesInInches));
      profile.unit = unit;
    }

    if (body.name !== undefined) profile.name = body.name;

    if (body.isDefault) {
      await MeasurementProfile.updateMany({ user: req.auth!.userId }, { $set: { isDefault: false } });
      profile.isDefault = true;
    }

    await profile.save();
    res.json({ ok: true });
  },
);

router.delete(
  '/profiles/:id',
  requireAuth,
  writeLimiter,
  validate({ params: profileParams }),
  async (req: Request, res: Response) => {
    const { id } = (req as Request & { validated: { params: { id: string } } }).validated.params;
    const result = await MeasurementProfile.deleteOne({ _id: id, user: req.auth!.userId });
    if (result.deletedCount === 0) throw notFound('Yeh measurement profile nahi mila.');
    res.json({ ok: true });
  },
);

export default router;
