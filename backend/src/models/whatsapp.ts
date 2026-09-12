import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  TEMPLATE_CATEGORIES,
  WA_CAMPAIGN_STATUSES,
  WA_JOB_STATUSES,
} from '../services/whatsapp/constants.js';

/* -------------------------------------------------------------------------- */
/* MessageLog — one row per WhatsApp message, end to end                       */
/* -------------------------------------------------------------------------- */

/**
 * The message ledger. Every attempt to contact a customer lands here, from OTPs
 * to marketing campaigns, so the Communications → Message Logs screen can show
 * exactly what went out and with what Meta status (sent/delivered/read/failed).
 *
 * `dedupeKey` is the idempotency guard: `orderId:type` for order events and
 * `campaignId:mobile` for campaigns. The unique index means a duplicate enqueue
 * is rejected by the database, even across worker restarts.
 */
const messageLogSchema = new Schema(
  {
    mobile: { type: String, required: true, maxlength: 20, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    campaignId: { type: Schema.Types.ObjectId, ref: 'WaCampaign', default: null },
    type: { type: String, enum: MESSAGE_TYPES, default: 'TEST' },
    category: { type: String, enum: TEMPLATE_CATEGORIES, default: 'UTILITY' },
    templateName: { type: String, default: '' },
    /** test | production — which credential set was used to send. */
    mode: { type: String, enum: ['test', 'production', ''], default: '' },
    /** Meta error code when the delivery failed (for developer triage). */
    errorCode: { type: Number, default: 0 },
    /** orderId:type or campaignId:mobile — set where the message must not repeat.
     *  No default: the sparse unique index only binds documents that actually
     *  carry a key, so one-off messages (admin test sends) never collide. */
    dedupeKey: { type: String, unique: true, sparse: true },
    /** Meta "wamid" — the key the webhook uses to update this row. */
    metaMessageId: { type: String, default: '', sparse: true },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'PENDING', index: true },
    failureReason: { type: String, default: '', maxlength: 400 },
    createdAt: { type: Date, default: Date.now, index: true },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

messageLogSchema.index({ orderId: 1, type: 1 });
messageLogSchema.index({ status: 1, createdAt: -1 });

export const MessageLog = model('MessageLog', messageLogSchema);
export type MessageLogDoc = InferSchemaType<typeof messageLogSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* WaJob — the durable outbox the worker drains in the background              */
/* -------------------------------------------------------------------------- */

/**
 * Order/checkout HTTP requests must never block on WhatsApp, and WhatsApp going
 * down must never fail an order — that is the whole point of this queue. Jobs
 * are Mongo-backed so they survive a restart, and a failed job retries with
 * backoff instead of silently disappearing.
 */
const waJobSchema = new Schema(
  {
    messageLog: { type: Schema.Types.ObjectId, ref: 'MessageLog', default: null },
    mobile: { type: String, required: true, maxlength: 20 },
    templateName: { type: String, required: true },
    language: { type: String, default: 'en', maxlength: 8 },
    category: { type: String, enum: TEMPLATE_CATEGORIES, default: 'UTILITY' },
    /** Meta "components" array (BODY parameters + optional URL button). */
    components: { type: Schema.Types.Mixed, default: [] },
    status: { type: String, enum: WA_JOB_STATUSES, default: 'PENDING', index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: '', maxlength: 400 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

waJobSchema.index({ status: 1, nextAt: 1, createdAt: 1 });

export const WaJob = model('WaJob', waJobSchema);
export type WaJobDoc = InferSchemaType<typeof waJobSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* WaCampaign — a marketing blast plus its cost estimate                       */
/* -------------------------------------------------------------------------- */

const segmentSchema = new Schema(
  {
    /** Only customers who have placed at least one order. */
    hasOrders: { type: Boolean, default: false },
    /** Minimum lifetime spend (minor units) to be included. */
    minSpendMinor: { type: Number, default: 0 },
    /** Product ids — include customers who bought any of these. */
    purchasedProductIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const waCampaignSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    /** Marketing template body text. {{1}}-style tokens are the only variables. */
    message: { type: String, required: true, maxlength: 1000 },
    templateName: { type: String, default: 'guddi_offer' },
    language: { type: String, default: 'en_US', maxlength: 8 },
    /**
     * Audience source: registered+opted-in users, order-based users, or any
     * manually typed number list (admin's explicit choice — opt-in bypassed).
     */
    targetSource: { type: String, enum: ['WEBSITE_USERS', 'ORDER_USERS', 'MANUAL_NUMBERS'], default: 'WEBSITE_USERS', index: true },
    /** Only used when targetSource = MANUAL_NUMBERS. */
    manualNumbers: { type: [String], default: [] },
    segment: { type: segmentSchema, default: () => ({}) },
    perMessageCostInr: { type: Number, default: 0.9, min: 0, max: 100 },
    status: { type: String, enum: WA_CAMPAIGN_STATUSES, default: 'DRAFT', index: true },
    recipientCount: { type: Number, default: 0 },
    estimatedCostInr: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

export const WaCampaign = model('WaCampaign', waCampaignSchema);
export type WaCampaignDoc = InferSchemaType<typeof waCampaignSchema> & { _id: Types.ObjectId };