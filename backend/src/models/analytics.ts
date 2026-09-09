import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ANALYTICS_EVENTS } from '../domain/constants.js';

/* -------------------------------------------------------------------------- */
/* AnalyticsEvent (README §76)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Privacy (README §63): we never store a raw IP address. The IP is used once,
 * in-process, to derive a coarse country/state/city and is then discarded; only
 * a salted hash remains, which is enough to count unique visitors but cannot be
 * reversed into an address. Session ids are client-generated random strings and
 * carry no personal data.
 */
const analyticsEventSchema = new Schema(
  {
    type: { type: String, enum: ANALYTICS_EVENTS, required: true, index: true },
    sessionId: { type: String, required: true, index: true, maxlength: 64 },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },

    path: { type: String, default: '', maxlength: 300 },
    referrer: { type: String, default: '', maxlength: 300 },
    /** Normalised acquisition channel: google / instagram / whatsapp / direct… */
    source: { type: String, default: 'direct', maxlength: 40, index: true },

    utm: {
      source: { type: String, default: '', maxlength: 60 },
      medium: { type: String, default: '', maxlength: 60 },
      campaign: { type: String, default: '', maxlength: 60 },
    },

    device: {
      type: { type: String, default: '', maxlength: 20 },
      os: { type: String, default: '', maxlength: 40 },
      browser: { type: String, default: '', maxlength: 40 },
      screen: { type: String, default: '', maxlength: 20 },
    },

    geo: {
      country: { type: String, default: '', maxlength: 2 },
      state: { type: String, default: '', maxlength: 60 },
      city: { type: String, default: '', maxlength: 60 },
    },

    ipHash: { type: String, default: '', maxlength: 64 },

    /** Free-form numeric payload: view duration, zoom count, cart value… */
    durationMs: { type: Number, default: 0, min: 0 },
    value: { type: Number, default: 0 },
    query: { type: String, default: '', maxlength: 120 },

    // Indexed below via schema.index() with a TTL — declaring `index: true`
    // here as well would create a second, redundant index.
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

analyticsEventSchema.index({ type: 1, at: -1 });
analyticsEventSchema.index({ product: 1, type: 1, at: -1 });
analyticsEventSchema.index({ sessionId: 1, at: 1 });
// Raw events roll off after 400 days; aggregates outlive them.
analyticsEventSchema.index({ at: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export const AnalyticsEvent = model('AnalyticsEvent', analyticsEventSchema);
export type AnalyticsEventDoc = InferSchemaType<typeof analyticsEventSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Setting — runtime-editable business config (README §24, §32)                */
/* -------------------------------------------------------------------------- */

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 60 },
    value: { type: Schema.Types.Mixed, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Setting = model('Setting', settingSchema);
export type SettingDoc = InferSchemaType<typeof settingSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* AdminActivityLog (README §64)                                               */
/* -------------------------------------------------------------------------- */

const adminActivityLogSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  adminName: { type: String, default: '' },
  action: { type: String, required: true, maxlength: 80 },
  entity: { type: String, default: '', maxlength: 40 },
  entityId: { type: String, default: '', maxlength: 40 },
  summary: { type: String, default: '', maxlength: 300 },
  at: { type: Date, default: Date.now, index: true },
});

export const AdminActivityLog = model('AdminActivityLog', adminActivityLogSchema);
export type AdminActivityLogDoc = InferSchemaType<typeof adminActivityLogSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* RateLimitHit — backing store for distributed rate limiting                  */
/* -------------------------------------------------------------------------- */

const rateLimitSchema = new Schema({
  _id: { type: String },
  hits: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitHit = model('RateLimitHit', rateLimitSchema);
