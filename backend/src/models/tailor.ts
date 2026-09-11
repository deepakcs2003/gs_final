import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { TAILOR_SPECIALIZATIONS, TAILOR_STATUSES } from '../domain/constants.js';

/**
 * A stitching team member. Capacity is per specialisation so the production
 * estimate can answer "how much can the simple-blouse bench produce today"
 * without guessing. Assignment is always manual (see Order.tailor).
 */
const tailorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    mobile: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
    address: { type: String, default: '', maxlength: 300 },

    /** Per-specialisation daily capacity, e.g. 2 simple blouses or 1 bridal. */
    specializationCaps: {
      type: [{ code: { type: String, enum: TAILOR_SPECIALIZATIONS }, capacityPerDay: { type: Number, min: 0.5, max: 20 } }],
      default: [],
    },

    experienceYears: { type: Number, min: 0, max: 60, default: 0 },
    /** ISO weekday numbers where this tailor works (0 = Sunday … 6 = Saturday). */
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    workingHours: { type: String, default: '10:00–18:00', maxlength: 40 },
    status: { type: String, enum: TAILOR_STATUSES, default: 'ACTIVE', index: true },
    notes: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

tailorSchema.index({ status: 1, name: 1 });

export const Tailor = model('Tailor', tailorSchema);
export type TailorDoc = InferSchemaType<typeof tailorSchema> & { _id: Types.ObjectId };