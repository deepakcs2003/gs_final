import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  CURRENCIES,
  MEASUREMENT_UNITS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRODUCT_TYPES,
} from '../domain/constants.js';

/* -------------------------------------------------------------------------- */
/* Cart / Wishlist                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Measurement captured against a cart line. Values are inches; the unit records
 * what the customer typed in so we can show it back the same way.
 */
const measurementValuesSchema = new Schema(
  {
    unit: { type: String, enum: MEASUREMENT_UNITS, default: 'inch' },
    values: { type: Map, of: Number, default: {} },
    confirmed: { type: Boolean, default: false },
    instructionVersion: { type: String, default: 'v1' },
  },
  { _id: false },
);

const accessoryColorSchema = new Schema(
  {
    id: { type: Schema.Types.ObjectId, required: true },
    colorName: { type: String, default: '', maxlength: 40 },
    colorHex: { type: String, default: '', maxlength: 20 },
  },
  { _id: false },
);

const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: PRODUCT_TYPES, required: true },
    quantity: { type: Number, required: true, min: 1, max: 20, default: 1 },

    // READY_MADE
    colorSlug: { type: String, default: '' },
    size: { type: Number, default: null },

    // CUSTOMIZE
    fabric: { type: Schema.Types.ObjectId, ref: 'Fabric', default: null },
    fabrics: { type: [{ type: Schema.Types.ObjectId, ref: 'Fabric' }], default: [] },
    laces: { type: [{ type: Schema.Types.ObjectId, ref: 'Lace' }], default: [] },
    laceColors: { type: [accessoryColorSchema], default: [] },
    latkans: { type: [{ type: Schema.Types.ObjectId, ref: 'Latkan' }], default: [] },
    latkanColors: { type: [accessoryColorSchema], default: [] },
    measurement: { type: measurementValuesSchema, default: null },

    note: { type: String, default: '', maxlength: 300 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

export const Cart = model('Cart', cartSchema);
export type CartDoc = InferSchemaType<typeof cartSchema> & { _id: Types.ObjectId };

const wishlistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    products: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  },
  { timestamps: true },
);

export const Wishlist = model('Wishlist', wishlistSchema);
export type WishlistDoc = InferSchemaType<typeof wishlistSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Order                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Order lines are immutable snapshots. If a product's price or name changes
 * tomorrow, what the customer actually bought must not change with it.
 * All money here is in the order currency's minor unit (paise / cents) as an
 * integer — which is also exactly what Razorpay expects.
 */
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: PRODUCT_TYPES, required: true },
    designId: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    image: { type: String, default: '' },

    quantity: { type: Number, required: true, min: 1, max: 20 },

    colorName: { type: String, default: '' },
    colorSlug: { type: String, default: '' },
    size: { type: Number, default: null },
    sku: { type: String, default: '' },

    fabricName: { type: String, default: '' },
    fabricMaterial: { type: String, default: '' },
    fabricColorName: { type: String, default: '' },
    laceNames: { type: [String], default: [] },
    latkanNames: { type: [String], default: [] },
    measurement: { type: measurementValuesSchema, default: null },

    /** Per-unit breakdown, all in the order currency's minor unit. */
    unitBaseMinor: { type: Number, required: true, min: 0 },
    unitFabricMinor: { type: Number, default: 0, min: 0 },
    unitLaceMinor: { type: Number, default: 0, min: 0 },
    unitLatkanMinor: { type: Number, default: 0, min: 0 },
    unitStitchingMinor: { type: Number, default: 0, min: 0 },
    lineTotalMinor: { type: Number, required: true, min: 0 },

    note: { type: String, default: '', maxlength: 300 },
  },
  { _id: true },
);

/**
 * Nested groups are declared as explicit sub-schemas rather than inline object
 * literals. Mongoose types an inline literal as optional, which would force a
 * null check on `order.payment` at every call site even though a payment block
 * always exists.
 */
const contactSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    mobile: { type: String, required: true, maxlength: 20, index: true },
    email: { type: String, default: '', maxlength: 160 },
  },
  { _id: false },
);

const orderAddressSchema = new Schema(
  {
    line1: { type: String, required: true, maxlength: 160 },
    line2: { type: String, default: '', maxlength: 160 },
    city: { type: String, required: true, maxlength: 60 },
    state: { type: String, required: true, maxlength: 60 },
    pincode: { type: String, required: true, maxlength: 12 },
    country: { type: String, required: true, maxlength: 2, uppercase: true, default: 'IN' },
  },
  { _id: false },
);

const amountsSchema = new Schema(
  {
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    shippingMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    couponCode: { type: String, default: '' },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING', index: true },
    razorpayOrderId: { type: String, default: '', index: true },
    razorpayPaymentId: { type: String, default: '' },
    /** Only ever set by server-side signature verification. */
    verifiedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
  },
  { _id: false },
);

const shippingSchema = new Schema(
  {
    provider: { type: String, default: '' },
    shiprocketOrderId: { type: String, default: '' },
    shipmentId: { type: String, default: '' },
    awb: { type: String, default: '' },
    courier: { type: String, default: '' },
    courierId: { type: String, default: '' },
    trackingUrl: { type: String, default: '' },
    estimatedDeliveryAt: { type: Date, default: null },
    /** Shipping lifecycle, separate from order.status (user spec). */
    status: { type: String, default: 'NOT_SHIPPED' },
    statusText: { type: String, default: '' },
    lastSyncedAt: { type: Date, default: null },
    pickupScheduledAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false },
);

const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: '', maxlength: 200 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, uppercase: true },

    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** Guest orders are looked up by orderNumber + mobile, never by id alone. */
    isGuest: { type: Boolean, default: false },

    contact: { type: contactSchema, required: true },
    address: { type: orderAddressSchema, required: true },

    currency: { type: String, enum: CURRENCIES, required: true },
    /** Rupees per 1 unit of `currency`, frozen at order time for auditability. */
    fxRateInr: { type: Number, required: true, min: 0 },

    items: { type: [orderItemSchema], required: true },

    amounts: { type: amountsSchema, required: true },
    payment: { type: paymentSchema, required: true },

    status: { type: String, enum: ORDER_STATUSES, default: 'PLACED', index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },

    shipping: { type: shippingSchema, required: true, default: () => ({}) },

    /** README §73 — "Please keep blouse length slightly longer." */
    customerNote: { type: String, default: '', maxlength: 500 },
    /** README §44 — stitching team needs to know which guide was followed. */
    measurementInstructionVersion: { type: String, default: 'v1' },

    placedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });

/** True when any line needs stitching — drives the STITCHING status step. */
orderSchema.virtual('hasCustomItems').get(function () {
  return (this.items ?? []).some((item) => item.type === 'CUSTOMIZE');
});

export const Order = model('Order', orderSchema);
export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Coupon / Review / Enquiry                                                   */
/* -------------------------------------------------------------------------- */

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
    description: { type: String, default: '', maxlength: 160 },
    type: { type: String, enum: ['PERCENT', 'FIXED'], required: true },
    /** Percent (0–100) or a fixed amount in rupees, per `type`. */
    value: { type: Number, required: true, min: 0 },
    minOrderInr: { type: Number, default: 0, min: 0 },
    maxDiscountInr: { type: Number, default: 0, min: 0 },
    categories: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    products: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Coupon = model('Coupon', couponSchema);
export type CouponDoc = InferSchemaType<typeof couponSchema> & { _id: Types.ObjectId };

const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    name: { type: String, required: true, maxlength: 60 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, default: '', maxlength: 1500 },
    photos: { type: [String], default: [] },
    /** Nothing is public until an admin approves it (README §34). */
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    verifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reviewSchema.index({ product: 1, status: 1, createdAt: -1 });

export const Review = model('Review', reviewSchema);
export type ReviewDoc = InferSchemaType<typeof reviewSchema> & { _id: Types.ObjectId };

const enquirySchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    channel: { type: String, enum: ['WHATSAPP', 'CALL', 'FORM'], default: 'WHATSAPP' },
    sessionId: { type: String, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    message: { type: String, default: '', maxlength: 1000 },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

export const Enquiry = model('Enquiry', enquirySchema);
export type EnquiryDoc = InferSchemaType<typeof enquirySchema> & { _id: Types.ObjectId };
