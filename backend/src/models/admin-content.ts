import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/* -------------------------------------------------------------------------- */
/* Color — centralised colour swatches (README §85.6)                          */
/* -------------------------------------------------------------------------- */

const colorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hex: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    image: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

colorSchema.index({ order: 1, name: 1 });

export const Color = model('Color', colorSchema);
export type ColorDoc = InferSchemaType<typeof colorSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Size — centralised size chart (README §85.7)                                */
/* -------------------------------------------------------------------------- */

const sizeSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 20 },
    value: { type: Number, required: true, unique: true, min: 18, max: 60 },
    priceModifierInr: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

sizeSchema.index({ order: 1, value: 1 });

export const Size = model('Size', sizeSchema);
export type SizeDoc = InferSchemaType<typeof sizeSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Banner — promotional creatives (README §85.13)                              */
/* -------------------------------------------------------------------------- */

const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    subtitle: { type: String, default: '', maxlength: 200 },
    image: { type: String, default: '' },
    ctaText: { type: String, default: 'Shop Now', maxlength: 40 },
    ctaLink: { type: String, default: '/', maxlength: 300 },
    offerText: { type: String, default: '', maxlength: 100 },
    position: { type: String, enum: ['hero', 'mid', 'footer'], default: 'hero' },
    isActive: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bannerSchema.index({ isActive: 1, order: 1 });

export const Banner = model('Banner', bannerSchema);
export type BannerDoc = InferSchemaType<typeof bannerSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* OfferPopup — timed promotional product popup (README §85.14)                */
/* -------------------------------------------------------------------------- */

const offerPopupSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    offerType: { type: String, enum: ['discount', 'free'], default: 'discount' },
    headline: { type: String, default: '', maxlength: 120 },
    limited: { type: Boolean, default: false },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    delaySeconds: { type: Number, default: 30, min: 5, max: 600 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

offerPopupSchema.index({ isActive: 1, order: 1, createdAt: -1 });

export const OfferPopup = model('OfferPopup', offerPopupSchema);
export type OfferPopupDoc = InferSchemaType<typeof offerPopupSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* Page — website content pages (README §85.12)                                */
/* -------------------------------------------------------------------------- */

const pageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    content: { type: String, default: '', maxlength: 50000 },
    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 180 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Page = model('Page', pageSchema);
export type PageDoc = InferSchemaType<typeof pageSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* HomepageSection — section ordering & config (README §85.10–85.11)           */
/* -------------------------------------------------------------------------- */

const homepageSectionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    subtitle: { type: String, default: '', maxlength: 200 },
    type: { type: String, enum: ['READY_MADE', 'CUSTOMIZE', 'SHOWCASE', 'TRENDING', 'NEW', 'FEATURED', 'CUSTOM'], default: 'CUSTOM' },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    productIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    maxProducts: { type: Number, default: 8, min: 1, max: 50 },
    buttonText: { type: String, default: 'View All', maxlength: 40 },
    buttonLink: { type: String, default: '/', maxlength: 300 },
  },
  { timestamps: true },
);

homepageSectionSchema.index({ order: 1 });

export const HomepageSection = model('HomepageSection', homepageSectionSchema);
export type HomepageSectionDoc = InferSchemaType<typeof homepageSectionSchema> & { _id: Types.ObjectId };

/* -------------------------------------------------------------------------- */
/* ProductCollection — admin-created curated product bundles / shareable links  */
/* -------------------------------------------------------------------------- */

const productCollectionSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 400 },
    productIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

productCollectionSchema.index({ isActive: 1, order: 1, createdAt: -1 });

export const ProductCollection = model('ProductCollection', productCollectionSchema);
export type ProductCollectionDoc = InferSchemaType<typeof productCollectionSchema> & { _id: Types.ObjectId };
