import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ADMIN_ROLES, MEASUREMENT_UNITS } from '../domain/constants.js';

/* -------------------------------------------------------------------------- */
/* User                                                                        */
/* -------------------------------------------------------------------------- */

const addressSchema = new Schema(
  {
    label: { type: String, default: 'Home', maxlength: 30 },
    name: { type: String, required: true, maxlength: 80 },
    mobile: { type: String, required: true, maxlength: 20 },
    line1: { type: String, required: true, maxlength: 160 },
    line2: { type: String, default: '', maxlength: 160 },
    city: { type: String, required: true, maxlength: 60 },
    state: { type: String, required: true, maxlength: 60 },
    pincode: { type: String, required: true, maxlength: 12 },
    country: { type: String, default: 'IN', maxlength: 2, uppercase: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

/**
 * Refresh tokens are bearer credentials, so only their SHA-256 hash is stored.
 * A database leak therefore cannot be replayed as a login.
 */
const refreshTokenSchema = new Schema(
  {
    hash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    userAgentHash: { type: String, default: '' },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    /** Login identity (README §23): mobile + OTP. Sparse so Google-only users fit. */
    mobile: { type: String, unique: true, sparse: true, trim: true, maxlength: 20 },
    mobileVerified: { type: Boolean, default: false },
    email: { type: String, lowercase: true, trim: true, maxlength: 160, unique: true, sparse: true },
    emailVerified: { type: Boolean, default: false },
    googleId: { type: String, unique: true, sparse: true },
    name: { type: String, default: '', maxlength: 80 },
    avatarUrl: { type: String, default: '' },

    addresses: { type: [addressSchema], default: [] },

    /** Empty for ordinary customers; populated only for staff (README §62). */
    adminRoles: { type: [String], enum: ADMIN_ROLES, default: [] },
    /** Present only for staff accounts. bcrypt, cost 12. */
    passwordHash: { type: String, default: null, select: false },

    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },

    isBlocked: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    lastSeenPath: { type: String, default: '', maxlength: 300 },

    /** WhatsApp communication preferences (README §WhatsApp). Marketing opt-in
     *  defaults OFF so a blast can never reach someone who did not ask for it. */
    whatsappOptIn: { type: Boolean, default: true },
    whatsappOptInAt: { type: Date, default: null },
    whatsappOptOutAt: { type: Date, default: null },
    whatsappTransactionalOptIn: { type: Boolean, default: true },
    whatsappMarketingOptIn: { type: Boolean, default: false },
    /** When the marketing cooldown clock last started for this customer. */
    lastMarketingAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.virtual('isAdmin').get(function () {
  return (this.adminRoles ?? []).length > 0;
});

export const User = model('User', userSchema);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* OTP                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The code itself is never stored — only a bcrypt hash, compared on verify.
 * `attempts` caps guessing per code; the route additionally rate-limits by
 * mobile and by IP. Mongo's TTL monitor sweeps expired documents.
 */
const otpSchema = new Schema({
  mobile: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  purpose: { type: String, enum: ['LOGIN'], default: 'LOGIN' },
  attempts: { type: Number, default: 0, max: 100 },
  consumedAt: { type: Date, default: null },
  ipHash: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ mobile: 1, createdAt: -1 });

export const OtpToken = model('OtpToken', otpSchema);
export type OtpTokenDoc = InferSchemaType<typeof otpSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Measurement configuration (README §19–20) — admin editable, not hard-coded  */
/* -------------------------------------------------------------------------- */

const measurementFieldSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, maxlength: 60 },
    /** Hinglish helper shown under the label, e.g. "Chaati ka sabse chauda part". */
    labelHi: { type: String, default: '', maxlength: 80 },
    instruction: { type: String, default: '', maxlength: 400 },
    gifUrl: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    /** Sanity bounds in inches; the API converts cm input before checking. */
    minInch: { type: Number, required: true, min: 1, max: 120 },
    maxInch: { type: Number, required: true, min: 1, max: 120 },
    required: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

measurementFieldSchema.index({ order: 1 });

export const MeasurementField = model('MeasurementField', measurementFieldSchema);
export type MeasurementFieldDoc = InferSchemaType<typeof measurementFieldSchema> & { _id: Types.ObjectId };

/**
 * Saved measurements for a logged-in customer (README §23). Guests keep theirs
 * in the cart item only, never server-side.
 */
const measurementProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: 'Default Profile', maxlength: 40 },
    unit: { type: String, enum: MEASUREMENT_UNITS, default: 'inch' },
    /** key -> value, always normalised to inches before storing. */
    values: { type: Map, of: Number, default: {} },
    isDefault: { type: Boolean, default: false },
    /** Which version of the instructions the customer measured against (§44). */
    instructionVersion: { type: String, default: 'v1', maxlength: 12 },
  },
  { timestamps: true },
);

measurementProfileSchema.index({ user: 1, isDefault: -1, updatedAt: -1 });

export const MeasurementProfile = model('MeasurementProfile', measurementProfileSchema);
export type MeasurementProfileDoc = InferSchemaType<typeof measurementProfileSchema> & { _id: Types.ObjectId };
