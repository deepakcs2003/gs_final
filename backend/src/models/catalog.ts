import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { IMAGE_KINDS, PRODUCT_TYPES } from '../domain/constants.js';

/* -------------------------------------------------------------------------- */
/* Category — admin-managed, never hard-coded (README §4)                      */
/* -------------------------------------------------------------------------- */

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameHi: { type: String, trim: true, maxlength: 60, default: '' },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    /** Which storefront sections this category appears under. */
    types: { type: [String], enum: PRODUCT_TYPES, default: [...PRODUCT_TYPES] },
    image: { type: String, default: '' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ order: 1, name: 1 });

export const Category = model('Category', categorySchema);
export type CategoryDoc = InferSchemaType<typeof categorySchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Fabric + Lace — the CUSTOMIZE picker (README §14–16)                        */
/* -------------------------------------------------------------------------- */

/** Colour variants the buyer can pick per fabric / lace / latkan. */
const colorOptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    hex: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
  },
  { _id: false },
);

const fabricSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** Broad material family used by the "Filter by fabric" facet. */
    material: { type: String, required: true, trim: true, maxlength: 40, index: true },
    colorName: { type: String, required: true, trim: true, maxlength: 40 },
    colorSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    colorHex: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    colors: { type: [colorOptionSchema], default: [] },
    embroidery: { type: [String], default: [] },
    priceInr: { type: Number, required: true, min: 0, max: 1_000_000 },
    image: { type: String, default: '' },
    /** README §48 — fabric stock is tracked separately from stitched stock. */
    inStock: { type: Boolean, default: true },
    stockMeters: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

fabricSchema.index({ isActive: 1, order: 1 });
fabricSchema.index({ material: 1, colorSlug: 1, priceInr: 1 });

export const Fabric = model('Fabric', fabricSchema);
export type FabricDoc = InferSchemaType<typeof fabricSchema> & { _id: Types.ObjectId };

const laceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    colorName: { type: String, default: '', maxlength: 40 },
    colorHex: { type: String, default: '#cccccc', match: /^#[0-9a-fA-F]{6}$/ },
    colors: { type: [colorOptionSchema], default: [] },
    priceInr: { type: Number, required: true, min: 0, max: 100_000 },
    image: { type: String, default: '' },
    inStock: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Lace = model('Lace', laceSchema);
export type LaceDoc = InferSchemaType<typeof laceSchema> & { _id: Types.ObjectId };

/** Blouse danglers / tassels — the same catalogue role as lace (README §14–16). */
const latkanSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    colorName: { type: String, default: '', maxlength: 40 },
    colorHex: { type: String, default: '#cccccc', match: /^#[0-9a-fA-F]{6}$/ },
    colors: { type: [colorOptionSchema], default: [] },
    priceInr: { type: Number, required: true, min: 0, max: 100_000 },
    image: { type: String, default: '' },
    inStock: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Latkan = model('Latkan', latkanSchema);
export type LatkanDoc = InferSchemaType<typeof latkanSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Product                                                                     */
/* -------------------------------------------------------------------------- */

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    kind: { type: String, enum: IMAGE_KINDS, default: 'other' },
    /** Cloudinary public_id, kept so the admin can delete the remote asset. */
    publicId: { type: String, default: '' },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
  { _id: false },
);

const colorSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 40 },
    slug: { type: String, required: true, lowercase: true },
    hex: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
  },
  { _id: false },
);

/** Size × colour stock matrix for READY_MADE (README §47). */
const variantSchema = new Schema(
  {
    colorSlug: { type: String, required: true, lowercase: true },
    size: { type: Number, required: true, min: 20, max: 60 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    sku: { type: String, default: '' },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    /** Human-facing code shown everywhere and searchable, e.g. GS-206. */
    designId: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: '', maxlength: 4000 },

    type: { type: String, enum: PRODUCT_TYPES, required: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subCategory: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    tags: { type: [String], default: [], index: true },

    /**
     * Money is stored as whole rupees (integers). Blouse pricing has no paise,
     * and integers keep totals exact — floats would drift on discounts.
     * Foreign currency is derived at request time, never stored on the product.
     */
    mrpInr: { type: Number, required: true, min: 0, max: 10_000_000 },
    sellingPriceInr: { type: Number, required: true, min: 0, max: 10_000_000, index: true },

    images: { type: [imageSchema], default: [] },
    videoUrl: { type: String, default: '' },

    colors: { type: [colorSchema], default: [] },
    sizes: { type: [Number], default: [] },
    variants: { type: [variantSchema], default: [] },

    /** CUSTOMIZE: empty means "every active fabric is allowed". */
    fabricOptions: { type: [{ type: Schema.Types.ObjectId, ref: 'Fabric' }], default: [] },
    laceOptions: { type: [{ type: Schema.Types.ObjectId, ref: 'Lace' }], default: [] },
    latkanOptions: { type: [{ type: Schema.Types.ObjectId, ref: 'Latkan' }], default: [] },
    defaultLaceCount: { type: Number, min: 0, max: 6, default: 2 },
    defaultLatkanCount: { type: Number, min: 0, max: 6, default: 2 },
    stitchingChargeInr: { type: Number, min: 0, default: 0 },

    fabricInfo: { type: String, default: '', maxlength: 300 },
    embroidery: { type: [String], default: [], index: true },
    careInstructions: { type: String, default: '', maxlength: 600 },
    stitchingInfo: { type: String, default: '', maxlength: 600 },
    stitchingDays: { type: Number, min: 0, max: 90, default: 7 },

    /** SHOWCASE only (README §25). */
    expectedAvailability: { type: String, default: '', maxlength: 80 },
    comingSoon: { type: Boolean, default: false },

    rating: {
      average: { type: Number, min: 0, max: 5, default: 0 },
      count: { type: Number, min: 0, default: 0 },
    },

    /** Denormalised counters kept for sorting and the admin dashboard (§39). */
    stats: {
      views: { type: Number, default: 0 },
      uniqueViews: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      totalViewMs: { type: Number, default: 0 },
      viewSessions: { type: Number, default: 0 },
      zooms: { type: Number, default: 0 },
      wishlists: { type: Number, default: 0 },
      cartAdds: { type: Number, default: 0 },
      buyNows: { type: Number, default: 0 },
      orders: { type: Number, default: 0 },
      whatsappEnquiries: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },

    seo: {
      title: { type: String, default: '', maxlength: 70 },
      description: { type: String, default: '', maxlength: 180 },
      keywords: { type: [String], default: [] },
      ogImage: { type: String, default: '' },
    },

    isActive: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date, default: Date.now },

    /** Which admin account created this product (set on create only). */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/** Discount is always derived — storing it invites the two values disagreeing. */
productSchema.virtual('discountPercent').get(function () {
  if (!this.mrpInr || this.mrpInr <= this.sellingPriceInr) return 0;
  return Math.round(((this.mrpInr - this.sellingPriceInr) / this.mrpInr) * 100);
});

/** Total sellable units, used for "Only 2 left" (README §67 — real stock only). */
productSchema.virtual('totalStock').get(function () {
  if (this.type !== 'READY_MADE') return null;
  return (this.variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);
});

productSchema.virtual('averageViewSeconds').get(function () {
  const sessions = this.stats?.viewSessions ?? 0;
  if (!sessions) return 0;
  return Math.round((this.stats?.totalViewMs ?? 0) / sessions / 1000);
});

// Text index powers search over name / design id / tags (README §31).
productSchema.index(
  { name: 'text', designId: 'text', tags: 'text', description: 'text', fabricInfo: 'text' },
  { weights: { designId: 12, name: 8, tags: 4, fabricInfo: 2, description: 1 }, name: 'product_search' },
);
productSchema.index({ type: 1, isActive: 1, publishedAt: -1, _id: -1 });
productSchema.index({ type: 1, category: 1, isActive: 1, sellingPriceInr: 1 });
productSchema.index({ 'stats.views': -1 });
productSchema.index({ 'colors.slug': 1 });

export const Product = model('Product', productSchema);
export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };
