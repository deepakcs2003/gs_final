import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { Category, Fabric, Lace, Latkan, Product } from '../models/catalog.js';
import { Coupon, Enquiry, Order, Review } from '../models/commerce.js';
import { MeasurementField, User } from '../models/user.js';
import { AdminActivityLog, AnalyticsEvent, Setting } from '../models/analytics.js';
import { Color, Size, Banner, OfferPopup, Page, HomepageSection } from '../models/admin-content.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { ORDER_STATUSES, ADMIN_ROLES, type AdminRole, type OrderStatus } from '../domain/constants.js';
import { notFound, forbidden, badRequest, conflict } from '../utils/errors.js';
import { invalidateSettingsCache } from '../services/settings.js';
import { uploadImage, MAX_UPLOAD_BYTES } from '../services/media/cloudinary.js';
import { generateLatkanSuggestion, generateFabricSuggestion, generateLaceSuggestion, generateProductSuggestions } from '../services/ai/qwen.js';
import { env, integrations, shiprocketMock } from '../config/env.js';
import {
  applyTrackingToOrder,
  assignAwb,
  cancelShipment,
  createShipment,
  generateLabel,
  recommendCouriers,
  schedulePickup,
  testConnection,
  trackCourier,
} from '../services/shipping/shiprocket.js';
import {
  getShiprocketSettings,
  updateShiprocketSettings,
  type ShiprocketSettings,
} from '../services/shipping/shiprocket-settings.js';
import { recordWebhookReceipt } from './webhooks.js';

const router = Router();
const idSchema = z.object({ id: z.string().trim().min(1).max(80) }).strict();
const orderNumberSchema = z.object({ orderNumber: z.string().trim().min(6).max(30) }).strict();
const statusSchema = z.object({ status: z.enum([...ORDER_STATUSES] as [OrderStatus, ...OrderStatus[]]), note: z.string().trim().max(200).default('') }).strict();
const reviewStatusSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']) }).strict();
const settingSchema = z.object({ value: z.unknown() }).strict();

const measurementSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  labelHi: z.string().trim().max(80).default(''),
  instruction: z.string().trim().max(400).default(''),
  gifUrl: z.string().trim().max(500).default(''),
  imageUrl: z.string().trim().max(500).default(''),
  minInch: z.number().min(1).max(120),
  maxInch: z.number().min(1).max(120),
  required: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
}).strict();

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  nameHi: z.string().trim().max(60).default(''),
  slug: z.string().trim().min(1).max(60),
  types: z.array(z.enum(['READY_MADE', 'CUSTOMIZE', 'SHOWCASE'])).default(['READY_MADE', 'CUSTOMIZE', 'SHOWCASE']),
  image: z.string().max(500).default(''),
  description: z.string().max(1000).default(''),
  seoTitle: z.string().max(70).default(''),
  seoDescription: z.string().max(180).default(''),
  order: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
}).strict();

const fabricSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80),
  material: z.string().trim().min(1).max(40),
  colorName: z.string().trim().min(1).max(40),
  colorSlug: z.string().trim().min(1).max(40),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  colors: z
    .array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .max(12)
    .default([]),
  embroidery: z.array(z.string().max(40)).default([]),
  priceInr: z.number().min(0).max(1_000_000),
  image: z.string().max(500).default(''),
  inStock: z.boolean().default(true),
  stockMeters: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const laceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80),
  colorName: z.string().max(40).default(''),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#cccccc'),
  colors: z
    .array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .max(12)
    .default([]),
  priceInr: z.number().min(0).max(100_000),
  image: z.string().max(500).default(''),
  width: z.string().max(40).default(''),
  sku: z.string().max(60).default(''),
  description: z.string().max(1000).default(''),
  inStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const latkanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80),
  colorName: z.string().max(40).default(''),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#cccccc'),
  colors: z
    .array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .max(12)
    .default([]),
  priceInr: z.number().min(0).max(100_000),
  image: z.string().max(500).default(''),
  inStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const colorSchema = z.object({
  name: z.string().trim().min(1).max(40),
  slug: z.string().trim().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  image: z.string().max(500).default(''),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const sizeSchema = z.object({
  label: z.string().trim().min(1).max(20),
  value: z.number().int().min(18).max(60),
  priceModifierInr: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const couponSchema = z.object({
  code: z.string().trim().min(2).max(24),
  description: z.string().max(160).default(''),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.number().min(0),
  minOrderInr: z.number().min(0).default(0),
  maxDiscountInr: z.number().min(0).default(0),
  categories: z.array(z.string()).default([]),
  products: z.array(z.string()).default([]),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(0).default(0),
  perUserLimit: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
}).strict();

const bannerSchema = z.object({
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().max(200).default(''),
  image: z.string().max(500).default(''),
  ctaText: z.string().max(40).default('Shop Now'),
  ctaLink: z.string().max(300).default('/'),
  offerText: z.string().max(100).default(''),
  position: z.enum(['hero', 'mid', 'footer']).default('hero'),
  isActive: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const offerPopupSchema = z.object({
  productId: z.string().min(1).max(30),
  offerType: z.enum(['discount', 'free']).default('discount'),
  headline: z.string().max(120).default(''),
  limited: z.boolean().default(false),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  delaySeconds: z.number().int().min(5).max(600).default(30),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
}).strict();

const pageSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(50000).default(''),
  seoTitle: z.string().max(70).default(''),
  seoDescription: z.string().max(180).default(''),
  isActive: z.boolean().default(true),
}).strict();

const homepageSectionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().max(200).default(''),
  type: z.enum(['READY_MADE', 'CUSTOMIZE', 'SHOWCASE', 'TRENDING', 'NEW', 'FEATURED', 'CUSTOM']).default('CUSTOM'),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
  productIds: z.array(z.string()).default([]),
  categoryId: z.string().nullable().default(null),
  maxProducts: z.number().int().min(1).max(50).default(8),
  buttonText: z.string().max(40).default('View All'),
  buttonLink: z.string().max(300).default('/'),
}).strict();

const userAdminSchema = z.object({
  mobile: z.string().trim().min(10).max(20),
  name: z.string().trim().max(80).default(''),
  roles: z.array(z.enum([...ADMIN_ROLES] as [AdminRole, ...AdminRole[]])).min(1),
}).strict();

const productSchemaBase = z.object({
  designId: z.string().trim().max(24).optional(), slug: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1).max(140), description: z.string().max(4000).default(''),
  type: z.enum(['READY_MADE', 'CUSTOMIZE', 'SHOWCASE']), category: z.string().min(1),
  subCategory: z.string().nullable().optional(), tags: z.array(z.string().max(60)).default([]),
  mrpInr: z.number().min(0), sellingPriceInr: z.number().min(0), images: z.array(z.unknown()).default([]),
  videoUrl: z.string().max(500).default(''), colors: z.array(z.unknown()).default([]), sizes: z.array(z.number()).default([]),
  variants: z.array(z.unknown()).default([]), fabricOptions: z.array(z.string()).default([]), laceOptions: z.array(z.string()).default([]),
  latkanOptions: z.array(z.string()).default([]),
  minFabricCount: z.number().int().min(1).max(6).default(1), maxFabricCount: z.number().int().min(1).max(6).default(1),
  minLaceCount: z.number().int().min(1).max(6).default(1), maxLaceCount: z.number().int().min(1).max(6).default(1),
  minLatkanCount: z.number().int().min(1).max(6).default(1), maxLatkanCount: z.number().int().min(1).max(6).default(1),
  stitchingChargeInr: z.number().min(0).default(0),
  fabricInfo: z.string().max(300).default(''), embroidery: z.array(z.string()).default([]), careInstructions: z.string().max(600).default(''),
  stitchingInfo: z.string().max(600).default(''), stitchingDays: z.number().int().min(0).max(90).default(7),
  expectedAvailability: z.string().max(80).default(''), comingSoon: z.boolean().default(false), isActive: z.boolean().default(true),
  seo: z.object({
    title: z.string().max(70).default(''),
    description: z.string().max(180).default(''),
    keywords: z.array(z.string().max(40)).default([]),
    ogImage: z.string().max(500).default(''),
  }).default(() => ({ title: '', description: '', keywords: [], ogImage: '' })),
}).strict();

const withValidProductRanges = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value: unknown, ctx) => {
  const product = value as {
    minFabricCount?: number;
    maxFabricCount?: number;
    minLaceCount?: number;
    maxLaceCount?: number;
    minLatkanCount?: number;
    maxLatkanCount?: number;
  };
  const ranges = [
    ['fabric', product.minFabricCount, product.maxFabricCount],
    ['lace', product.minLaceCount, product.maxLaceCount],
    ['latkan', product.minLatkanCount, product.maxLatkanCount],
  ] as const;
  for (const [label, minimum, maximum] of ranges) {
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`min${label.charAt(0).toUpperCase()}${label.slice(1)}Count`], message: `${label} minimum maximum se bada nahi ho sakta.` });
    }
  }
});

const productSchema = withValidProductRanges(productSchemaBase);
const productPatchSchema = withValidProductRanges(productSchemaBase.partial());

function adminId(req: Request): string { return req.auth!.userId; }

/** Slug-ready form of any string, e.g. "Bridal Red Blouse" → "bridal-red-blouse". */
function slugFrom(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** First free slug for a name: base, base-2, base-3 … */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugFrom(name) || 'product';
  let slug = base;
  let n = 2;
  while (await Product.exists({ slug })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/** Next human-facing code, e.g. GS-207. */
async function nextDesignId(): Promise<string> {
  const docs = await Product.find({ designId: /^GS-\d+$/ }).select('designId').lean();
  let max = 0;
  for (const d of docs) {
    const match = /^GS-(\d+)$/.exec(d.designId);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `GS-${max + 1}`;
}

async function logAction(req: Request, action: string, entity: string, entityId: string, summary: string): Promise<void> {
  await AdminActivityLog.create({ admin: adminId(req), action, entity, entityId, summary });
}

function validateBody<T>(req: Request, schema: z.ZodType<T>): T {
  return schema.parse(req.body);
}

router.use(requireAdmin());

/* ========================================================================== */
/* Image upload — Cloudinary (admin ImagePicker)                              */
/* ========================================================================== */

const imageUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
});

/** Wraps multer so its generic errors surface as customer-safe AppErrors. */
function runImageUpload(req: Request, res: Response, next: NextFunction): void {
  imageUploader.array('files', 10)(req, res, (err) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('Har image 5MB se choti honi chahiye.'));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest('Ek saath max 10 images upload kar sakte hain.'));
      return next(badRequest('Upload fail hua — file dobara try karein.'));
    }
    next(err);
  });
}

router.post('/upload', writeLimiter, runImageUpload, async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('Koi image select nahi hui.');
  const uploaded = await Promise.all(
    files.map(async (file) => {
      const result = await uploadImage(file.buffer, 'admin');
      return { url: result.url, publicId: result.publicId, width: result.width, height: result.height };
    }),
  );
  await logAction(req, 'UPLOAD_IMAGE', 'MEDIA', 'upload', `${uploaded.length} image(s) uploaded`);
  res.json({ files: uploaded });
});

/* ========================================================================== */
/* Dashboard — 85.2                                                           */
/* ========================================================================== */

router.get('/dashboard', readLimiter, async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const range = { $gte: from, $lte: to };
  const [products, orders, customers, events, revenue, statuses, topProducts, cartEvents, wishlistEvents, whatsappEnquiries, lowStockProducts, failedPayments] = await Promise.all([
    Product.countDocuments({ isActive: true }), Order.countDocuments(),
    User.countDocuments(), AnalyticsEvent.countDocuments({ at: range }),
    Order.aggregate([{ $match: { placedAt: range, 'payment.status': { $in: ['PAID', 'COD_PENDING'] } } }, { $group: { _id: null, totalMinor: { $sum: '$amounts.totalMinor' }, count: { $sum: 1 } } }]),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { at: range, type: 'PRODUCT_VIEW', product: { $ne: null } } }, { $group: { _id: '$product', views: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 5 }, { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } }, { $unwind: '$product' }, { $project: { _id: 1, views: 1, designId: '$product.designId', name: '$product.name' } }]),
    AnalyticsEvent.countDocuments({ at: range, type: 'CART_ADD' }),
    AnalyticsEvent.countDocuments({ at: range, type: 'WISHLIST_ADD' }),
    Enquiry.countDocuments({ createdAt: { $lte: to } }),
    Product.aggregate([{ $unwind: '$variants' }, { $group: { _id: '$_id', designId: { $first: '$designId' }, name: { $first: '$name' }, totalStock: { $sum: '$variants.stock' } } }, { $match: { totalStock: { $lte: 5 } } }, { $limit: 10 }]),
    Order.countDocuments({ 'payment.status': 'FAILED' }),
  ]);
  res.json({
    range: { from, to },
    cards: {
      products, orders, customers, events,
      revenueMinor: revenue[0]?.totalMinor ?? 0,
      revenueOrders: revenue[0]?.count ?? 0,
      cartAdds: cartEvents, wishlistAdds: wishlistEvents,
      whatsappEnquiries, failedPayments,
    },
    statuses, topProducts, lowStockProducts,
  });
});

/* ========================================================================== */
/* Orders — 85.19–85.23                                                       */
/* ========================================================================== */

router.get('/orders', readLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status && ORDER_STATUSES.includes(String(req.query.status) as OrderStatus)) filter.status = req.query.status;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (q) filter.$or = [{ orderNumber: new RegExp(q, 'i') }, { 'contact.name': new RegExp(q, 'i') }, { 'contact.mobile': new RegExp(q, 'i') }];
  }
  if (req.query.from || req.query.to) {
    const range: Record<string, Date> = {};
    if (req.query.from) range.$gte = new Date(String(req.query.from));
    if (req.query.to) range.$lte = new Date(String(req.query.to));
    filter.placedAt = range;
  }
  const items = await Order.find(filter).sort({ placedAt: -1 }).limit(300).select('-__v').lean();
  res.json({ items });
});

router.get('/orders/search', readLimiter, async (_req: Request, res: Response) => res.json({ ok: true }));

router.get('/orders/:orderNumber', readLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber }).lean();
  if (!order) throw notFound('Order nahi mila.');
  res.json({ order });
});

router.patch('/orders/:orderNumber/status', writeLimiter, validate({ params: orderNumberSchema, body: statusSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const { status, note } = (req as ValidatedRequest<{ status: OrderStatus; note: string }>).validated.body;
  const order = await Order.findOneAndUpdate({ orderNumber }, { $set: { status }, $push: { statusHistory: { status, note, at: new Date() } } }, { new: true });
  if (!order) throw notFound('Order nahi mila.');
  await logAction(req, 'UPDATE_STATUS', 'ORDER', orderNumber, `${orderNumber} -> ${status}${note ? ` (${note})` : ''}`);
  res.json({ order });
});

router.patch('/orders/:orderNumber/shipping', writeLimiter, validate({
  params: orderNumberSchema,
  body: z.object({
    shiprocketOrderId: z.string().max(60).default(''),
    shipmentId: z.string().max(60).default(''),
    awb: z.string().max(60).default(''),
    courier: z.string().max(60).default(''),
    trackingUrl: z.string().max(300).default(''),
    estimatedDeliveryAt: z.coerce.date().nullable().optional(),
  }).strict(),
}), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  // Merge, never replace: the whole shipping object carries lifecycle state
  // (provider/status/timestamps) that a manual edit must not wipe.
  for (const key of ['shiprocketOrderId', 'shipmentId', 'awb', 'courier', 'trackingUrl'] as const) {
    if (body[key] !== undefined) order.shipping[key] = String(body[key] ?? '');
  }
  if (body.estimatedDeliveryAt !== undefined) order.set('shipping.estimatedDeliveryAt', body.estimatedDeliveryAt as Date | null);
  await order.save();
  await logAction(req, 'UPDATE_SHIPPING', 'ORDER', orderNumber, `Shipping updated for ${orderNumber}`);
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ order: fresh });
});

/* ========================================================================== */
/* Shipping — Shiprocket (user spec STEP 1-15)                                */
/* ========================================================================== */

const shiprocketSettingsSchema = z
  .object({
    env: z.enum(['development', 'production']).optional(),
    autoCreate: z.boolean().optional(),
    autoAssignAwb: z.boolean().optional(),
    autoPickup: z.boolean().optional(),
    trackingSync: z.boolean().optional(),
    pickupLocation: z.string().trim().max(60).optional(),
  })
  .strict();

function maskEmail(email: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 2) return email.slice(0, 2) + '***' + email.slice(at);
  return email.slice(0, 2) + '***' + email.slice(at);
}

router.get('/shipping/shiprocket/status', readLimiter, async (req: Request, res: Response) => {
  const [settings, countDoc, lastAtDoc] = await Promise.all([
    getShiprocketSettings(),
    Setting.findOne({ key: 'shiprocketWebhookCount' }).lean(),
    Setting.findOne({ key: 'shiprocketWebhookLastAt' }).lean(),
  ]);
  const test = await testConnection();
  res.json({
    mode: shiprocketMock ? 'mock' : 'live',
    mock: shiprocketMock,
    configured: integrations.shiprocket,
    connected: test.connected,
    lastTestedAt: test.testedAt,
    credentials: {
      email: maskEmail(env.SHIPROCKET_EMAIL),
      passwordSet: Boolean(env.SHIPROCKET_PASSWORD),
    },
    settings,
    webhook: {
      url: `${env.APP_BASE_URL}/api/webhooks/shiprocket`,
      lastAt: lastAtDoc?.value ?? null,
      count: Number(countDoc?.value ?? 0),
    },
  });
});

router.patch('/shipping/shiprocket/settings', writeLimiter, validate({ body: shiprocketSettingsSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<Partial<ShiprocketSettings>>).validated.body;
  const settings = await updateShiprocketSettings(body);
  await logAction(req, 'UPDATE', 'SHIPROCKET_SETTINGS', 'settings', 'Shiprocket settings updated');
  res.json({ settings });
});

router.post('/shipping/shiprocket/test-connection', writeLimiter, async (req: Request, res: Response) => {
  const result = await testConnection();
  await logAction(req, 'TEST_CONNECTION', 'SHIPROCKET_SETTINGS', 'settings', `Shiprocket test: ${result.message}`);
  res.json(result);
});

router.post('/shipping/shiprocket/test-webhook', writeLimiter, async (req: Request, res: Response) => {
  await recordWebhookReceipt('shiprocket');
  await logAction(req, 'TEST_WEBHOOK', 'SHIPROCKET_SETTINGS', 'settings', 'Shiprocket webhook test receipt recorded');
  res.json({ ok: true, message: 'Webhook receipt recorded (test). Shippedrocket panel "Webhook connected" update hoga.' });
});

/** Recommended courier list pre-filled by the admin AWB form. */
router.get('/orders/:orderNumber/shiprocket/recommend', readLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber }).lean();
  if (!order) throw notFound('Order nahi mila.');
  if (!order.shipping?.shipmentId) throw badRequest('Pehle shipment create karein.');
  const couriers = await recommendCouriers(order.shipping.shipmentId);
  res.json({ couriers });
});

/** Auto-assigns + optionally auto-picks-up once a shipment exists (toggles). */
async function autoAssignAndPickup(
  order: InstanceType<typeof Order>,
  settings: ShiprocketSettings,
): Promise<void> {
  if (!order.shipping.shipmentId) return;
  const couriers = await recommendCouriers(order.shipping.shipmentId);
  const rated = couriers.find((c) => c.rate && c.rate > 0) ?? couriers[0];
  if (!rated) return;
  const awbRes = await assignAwb(order.shipping.shipmentId, rated.courierId);
  order.shipping.awb = awbRes.awb;
  order.shipping.courierId = rated.courierId;
  order.shipping.courier = awbRes.courierName;
  order.shipping.trackingUrl = awbRes.trackingUrl
    ? awbRes.trackingUrl
    : awbRes.awb
      ? `https://www.shiprocket.in/tracking/awb/${awbRes.awb}`
      : '';
  order.shipping.status = 'AWB_ASSIGNED';
  if (settings.autoPickup) {
    const pickup = await schedulePickup(order.shipping.shipmentId, settings.pickupLocation);
    order.shipping.pickupScheduledAt = pickup.pickupScheduledAt ? new Date(pickup.pickupScheduledAt) : new Date();
    order.shipping.status = 'PICKUP_SCHEDULED';
  }
}

router.post('/orders/:orderNumber/shiprocket/create', writeLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const [order, settings] = await Promise.all([
    Order.findOne({ orderNumber }),
    getShiprocketSettings(),
  ]);
  if (!order) throw notFound('Order nahi mila.');
  if (order.shipping.shiprocketOrderId)
    throw conflict(`Shipment pehle se hai: ${order.shipping.shiprocketOrderId}`);

  const result = await createShipment(order, settings.pickupLocation);
  order.shipping.provider = 'SHIPROCKET';
  order.shipping.shiprocketOrderId = result.shiprocketOrderId;
  order.shipping.shipmentId = result.shipmentId;
  order.shipping.status = 'SHIPMENT_CREATED';
  if (settings.autoAssignAwb) await autoAssignAndPickup(order, settings);
  await order.save();

  await logAction(req, 'SHIPROCKET_CREATE', 'ORDER', orderNumber, `${orderNumber} -> shipment ${result.shiprocketOrderId}`);
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ order: fresh, result });
});

const awbSchema = z.object({
  courierId: z.string().trim().max(40).optional(),
  courierName: z.string().trim().max(60).optional(),
}).strict();

router.post('/orders/:orderNumber/shiprocket/awb', writeLimiter, validate({ params: orderNumberSchema, body: awbSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const body = (req as ValidatedRequest<{ courierId?: string; courierName?: string }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (!order.shipping.shiprocketOrderId || !order.shipping.shipmentId)
    throw badRequest('Pehle shipment create karein.');

  let courierId = body.courierId;
  if (!courierId) {
    const couriers = await recommendCouriers(order.shipping.shipmentId);
    const first = couriers[0];
    if (!first) throw badRequest('Courier list nahi mili. courierId manually bhejein.');
    courierId = first.courierId;
  }

  const result = await assignAwb(order.shipping.shipmentId, courierId);
  order.shipping.awb = result.awb;
  order.shipping.courierId = courierId;
  order.shipping.courier = body.courierName || result.courierName || 'Courier';
  order.shipping.trackingUrl =
    result.trackingUrl || (order.shipping.awb ? `https://www.shiprocket.in/tracking/awb/${order.shipping.awb}` : '');
  order.shipping.status = 'AWB_ASSIGNED';
  await order.save();

  await logAction(req, 'SHIPROCKET_AWB', 'ORDER', orderNumber, `${orderNumber} -> AWB ${result.awb}`);
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ order: fresh, result });
});

router.post('/orders/:orderNumber/shiprocket/pickup', writeLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const [order, settings] = await Promise.all([Order.findOne({ orderNumber }), getShiprocketSettings()]);
  if (!order) throw notFound('Order nahi mila.');
  if (!order.shipping.awb) throw badRequest('Pehle AWB assign karein.');

  const result = await schedulePickup(order.shipping.shipmentId, settings.pickupLocation);
  order.shipping.pickupScheduledAt = result.pickupScheduledAt ? new Date(result.pickupScheduledAt) : new Date();
  order.shipping.status = 'PICKUP_SCHEDULED';
  await order.save();

  await logAction(req, 'SHIPROCKET_PICKUP', 'ORDER', orderNumber, `${orderNumber} -> pickup scheduled`);
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ order: fresh, result });
});

router.post('/orders/:orderNumber/shiprocket/label', writeLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber }).lean();
  if (!order) throw notFound('Order nahi mila.');
  if (!order.shipping?.shipmentId) throw badRequest('Pehle shipment create karein.');
  const result = await generateLabel(order.shipping.shipmentId);
  res.json(result);
});

async function doSyncOrderTracking(
  req: Request,
  orderNumber: string,
  mode: 'SYNC' | 'VIEW',
): Promise<void> {
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  const { shipmentId, awb, shiprocketOrderId } = order.shipping;
  if (!shipmentId && !awb && !shiprocketOrderId) throw badRequest('Shipment abhi nahi bana.');

  const trackingId = shipmentId || awb || shiprocketOrderId;
  const track = await trackCourier(trackingId, Boolean(awb));
  await applyTrackingToOrder(order, track, mode === 'SYNC' ? 'Tracking sync (admin)' : 'Tracking update');
  if (mode === 'SYNC') await logAction(req, 'SHIPROCKET_SYNC', 'ORDER', orderNumber, `${orderNumber} -> ${track.status}`);
}

router.get('/orders/:orderNumber/shiprocket/tracking', readLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  await doSyncOrderTracking(req, orderNumber, 'VIEW');
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ tracking: fresh?.shipping ?? {}, order: fresh });
});

router.post('/orders/:orderNumber/shiprocket/sync', writeLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  await doSyncOrderTracking(req, orderNumber, 'SYNC');
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ tracking: fresh?.shipping ?? {}, order: fresh });
});

router.post('/orders/:orderNumber/shiprocket/cancel', writeLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (!order.shipping.shipmentId && !order.shipping.shiprocketOrderId)
    throw badRequest('Shipment cancel karne ke liye pehle shipment create karein.');

  const result = await cancelShipment(order.shipping.shiprocketOrderId, order.shipping.shipmentId);
  order.shipping.status = 'CANCELLED';
  await order.save();
  await logAction(req, 'SHIPROCKET_CANCEL', 'ORDER', orderNumber, `${orderNumber} -> cancelled`);
  res.json({ order: await Order.findOne({ orderNumber }).lean(), result });
});

/* ========================================================================== */
/* Products — 85.3                                                            */
/* ========================================================================== */

router.get('/products', readLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (q) filter.$or = [{ designId: new RegExp(q, 'i') }, { name: new RegExp(q, 'i') }, { slug: new RegExp(q, 'i') }];
  }
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.includeArchived !== 'true') filter.isActive = true;
  const items = await Product.find(filter).sort({ updatedAt: -1 }).limit(300).populate('category', 'name slug').populate('createdBy', 'name mobile').lean();
  res.json({ items });
});

router.post('/products', writeLimiter, validate({ body: productSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof productSchema>>).validated.body;
  // Blank design ID / slug are fine — they are generated automatically.
  const designId = body.designId?.trim() ? body.designId.trim() : await nextDesignId();
  const slug = body.slug?.trim() ? body.slug.trim().toLowerCase() : await uniqueSlug(body.name);
  const product = await Product.create({ ...body, designId, slug, createdBy: adminId(req) });
  await logAction(req, 'CREATE', 'PRODUCT', String(product._id), product.designId);
  res.status(201).json({ product });
});

/* ========================================================================== */
/* Qwen auto-fill — admin Add Product helper (kept separate on purpose)        */
/* ========================================================================== */

const qwenBodySchema = z.object({ imageUrl: z.string().url().max(500) }).strict();
/** Products analyse the WHOLE image set (front first, then back/sleeve/…). */
const productQwenBodySchema = z
  .object({ imageUrls: z.array(z.string().url().max(500)).min(1).max(10) })
  .strict();

router.post('/products/generate-with-qwen', writeLimiter, validate({ body: productQwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrls } = (req as ValidatedRequest<{ imageUrls: string[] }>).validated.body;

  const suggestion = await generateProductSuggestions(imageUrls);

  // Suggest categories ONLY when Qwen's guesses match real, active categories.
  // The _ids are what the existing form's <Select> stores, so the frontend can
  // drop them straight into `form.category` / `form.subCategory`.
  const categories = await Category.find().select('name slug').lean();
  const categoryIds = (suggestion.categoryNames ?? []).slice(0, 5).reduce<string[]>((acc, raw) => {
    const wanted = raw.trim().toLowerCase();
    if (!wanted) return acc;
    const match =
      categories.find((c) => c.name.toLowerCase() === wanted || c.slug.toLowerCase() === wanted) ??
      // Loose contains match before giving up (e.g. "sarees" → "Saree").
      categories.find((c) => wanted.includes(c.slug) || c.slug.includes(wanted));
    if (match && !acc.includes(String(match._id))) acc.push(String(match._id));
    return acc;
  }, []);

  await logAction(req, 'GENERATE_WITH_QWEN', 'PRODUCT', 'preview', `Suggested from ${imageUrls.length} image(s) for ${imageUrls[0]?.slice(0, 80)}`);
  res.json({ suggestion: { ...suggestion, categoryIds } });
});

/* Qwen auto-fill for the Catalog module — fabric / lace / latkan. Suggest
 * only catalog-ready fields; business numbers always stay review-before-save. */

router.post('/fabrics/generate-with-qwen', writeLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateFabricSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'FABRIC', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.post('/laces/generate-with-qwen', writeLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateLaceSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'LACE', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.post('/latkans/generate-with-qwen', writeLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateLatkanSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'LATKAN', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.get('/products/:id', readLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findById(id).populate('category', 'name slug').populate('subCategory', 'name slug').populate('createdBy', 'name mobile').lean();
  if (!product) throw notFound('Product nahi mila.');
  res.json({ product });
});

router.patch('/products/:id', writeLimiter, validate({ params: idSchema, body: productPatchSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const product = await Product.findById(id);
  if (!product) throw notFound('Product nahi mila.');

  const patch: Record<string, unknown> = { ...body };
  // A blank slug regenerates from the (possibly new) name; a blank design ID is
  // ignored so an existing code is never cleared by accident.
  if (patch.designId !== undefined && !String(patch.designId).trim()) delete patch.designId;
  if (patch.slug !== undefined && !String(patch.slug).trim()) {
    patch.slug = await uniqueSlug((patch.name as string)?.trim() || product.name);
  }

  const updated = await Product.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
  if (!updated) throw notFound('Product nahi mila.');
  await logAction(req, 'UPDATE', 'PRODUCT', id, updated.designId);
  res.json({ product: updated });
});

router.delete('/products/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!product) throw notFound('Product nahi mila.');
  await logAction(req, 'ARCHIVE', 'PRODUCT', id, product.designId);
  res.json({ ok: true });
});

router.post('/products/:id/duplicate', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findById(id).lean();
  if (!product) throw notFound('Product nahi mila.');
  const { _id, createdAt, updatedAt, publishedAt, ...rest } = product;
  const copy = await Product.create({ ...rest, designId: `${product.designId}-C`, slug: `${product.slug}-copy`, isActive: false, name: `${product.name} (Copy)`, createdBy: adminId(req) });
  await logAction(req, 'DUPLICATE', 'PRODUCT', String(copy._id), copy.designId);
  res.status(201).json({ product: copy });
});

/* ========================================================================== */
/* Categories — 85.9                                                          */
/* ========================================================================== */

router.get('/categories', readLimiter, async (_req: Request, res: Response) => {
  const items = await Category.find().sort({ order: 1, name: 1 }).lean();
  const counts = await Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json({ items: items.map((c) => ({ ...c, productCount: countMap.get(String(c._id)) ?? 0 })) });
});

router.post('/categories', writeLimiter, validate({ body: categorySchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof categorySchema>>).validated.body;
  const category = await Category.create(body);
  await logAction(req, 'CREATE', 'CATEGORY', String(category._id), category.name);
  res.status(201).json({ category });
});

router.patch('/categories/:id', writeLimiter, validate({ params: idSchema, body: categorySchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const category = await Category.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!category) throw notFound('Category nahi mili.');
  await logAction(req, 'UPDATE', 'CATEGORY', id, category.name);
  res.json({ category });
});

router.delete('/categories/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const used = await Product.countDocuments({ category: id });
  if (used > 0) throw conflict('Is category mein products hain. Pehle unhe move karein.');
  const category = await Category.findByIdAndDelete(id);
  if (!category) throw notFound('Category nahi mili.');
  await logAction(req, 'DELETE', 'CATEGORY', id, category.name);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Fabrics — 85.4                                                             */
/* ========================================================================== */

router.get('/fabrics', readLimiter, async (_req: Request, res: Response) => {
  const items = await Fabric.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/fabrics', writeLimiter, validate({ body: fabricSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof fabricSchema>>).validated.body;
  const fabric = await Fabric.create(body);
  await logAction(req, 'CREATE', 'FABRIC', String(fabric._id), fabric.name);
  res.status(201).json({ fabric });
});

router.patch('/fabrics/:id', writeLimiter, validate({ params: idSchema, body: fabricSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const fabric = await Fabric.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!fabric) throw notFound('Fabric nahi mila.');
  await logAction(req, 'UPDATE', 'FABRIC', id, fabric.name);
  res.json({ fabric });
});

router.delete('/fabrics/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const fabric = await Fabric.findByIdAndDelete(id);
  if (!fabric) throw notFound('Fabric nahi mila.');
  await logAction(req, 'DELETE', 'FABRIC', id, fabric.name);
  res.json({ ok: true });
});

router.post('/fabrics/:id/duplicate', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const fabric = await Fabric.findById(id).lean();
  if (!fabric) throw notFound('Fabric nahi mila.');
  const { _id, createdAt, updatedAt, ...rest } = fabric;
  const copy = await Fabric.create({ ...rest, name: `${fabric.name} (Copy)`, slug: `${fabric.slug}-copy`, isActive: false });
  await logAction(req, 'DUPLICATE', 'FABRIC', String(copy._id), copy.name);
  res.status(201).json({ fabric: copy });
});

/* ========================================================================== */
/* Laces — 85.5                                                               */
/* ========================================================================== */

router.get('/laces', readLimiter, async (_req: Request, res: Response) => {
  const items = await Lace.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/laces', writeLimiter, validate({ body: laceSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof laceSchema>>).validated.body;
  const lace = await Lace.create(body);
  await logAction(req, 'CREATE', 'LACE', String(lace._id), lace.name);
  res.status(201).json({ lace });
});

router.patch('/laces/:id', writeLimiter, validate({ params: idSchema, body: laceSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const lace = await Lace.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!lace) throw notFound('Lace nahi mila.');
  await logAction(req, 'UPDATE', 'LACE', id, lace.name);
  res.json({ lace });
});

router.delete('/laces/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const lace = await Lace.findByIdAndDelete(id);
  if (!lace) throw notFound('Lace nahi mila.');
  await logAction(req, 'DELETE', 'LACE', id, lace.name);
  res.json({ ok: true });
});

router.post('/laces/:id/duplicate', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const lace = await Lace.findById(id).lean();
  if (!lace) throw notFound('Lace nahi mila.');
  const { _id, createdAt, updatedAt, ...rest } = lace;
  const copy = await Lace.create({ ...rest, name: `${lace.name} (Copy)`, slug: `${lace.slug}-copy`, isActive: false });
  await logAction(req, 'DUPLICATE', 'LACE', String(copy._id), copy.name);
  res.status(201).json({ lace: copy });
});

/* ========================================================================== */
/* Latkans — blouse danglers (same catalogue role as lace)                    */
/* ========================================================================== */

router.get('/latkans', readLimiter, async (_req: Request, res: Response) => {
  const items = await Latkan.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/latkans', writeLimiter, validate({ body: latkanSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof latkanSchema>>).validated.body;
  const latkan = await Latkan.create(body);
  await logAction(req, 'CREATE', 'LATKAN', String(latkan._id), latkan.name);
  res.status(201).json({ latkan });
});

router.patch('/latkans/:id', writeLimiter, validate({ params: idSchema, body: latkanSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const latkan = await Latkan.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!latkan) throw notFound('Latkan nahi mila.');
  await logAction(req, 'UPDATE', 'LATKAN', id, latkan.name);
  res.json({ latkan });
});

router.delete('/latkans/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const latkan = await Latkan.findByIdAndDelete(id);
  if (!latkan) throw notFound('Latkan nahi mila.');
  await logAction(req, 'DELETE', 'LATKAN', id, latkan.name);
  res.json({ ok: true });
});

router.post('/latkans/:id/duplicate', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const latkan = await Latkan.findById(id).lean();
  if (!latkan) throw notFound('Latkan nahi mila.');
  const { _id, createdAt, updatedAt, ...rest } = latkan;
  const copy = await Latkan.create({ ...rest, name: `${latkan.name} (Copy)`, slug: `${latkan.slug}-copy`, isActive: false });
  await logAction(req, 'DUPLICATE', 'LATKAN', String(copy._id), copy.name);
  res.status(201).json({ latkan: copy });
});

/* ========================================================================== */
/* Colors — 85.6                                                              */
/* ========================================================================== */

router.get('/colors', readLimiter, async (_req: Request, res: Response) => {
  const items = await Color.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/colors', writeLimiter, validate({ body: colorSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof colorSchema>>).validated.body;
  const color = await Color.create(body);
  await logAction(req, 'CREATE', 'COLOR', String(color._id), color.name);
  res.status(201).json({ color });
});

router.patch('/colors/:id', writeLimiter, validate({ params: idSchema, body: colorSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const color = await Color.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!color) throw notFound('Color nahi mila.');
  await logAction(req, 'UPDATE', 'COLOR', id, color.name);
  res.json({ color });
});

router.delete('/colors/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const color = await Color.findByIdAndDelete(id);
  if (!color) throw notFound('Color nahi mila.');
  await logAction(req, 'DELETE', 'COLOR', id, color.name);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Sizes — 85.7                                                               */
/* ========================================================================== */

router.get('/sizes', readLimiter, async (_req: Request, res: Response) => {
  const items = await Size.find().sort({ order: 1, value: 1 }).lean();
  res.json({ items });
});

router.post('/sizes', writeLimiter, validate({ body: sizeSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof sizeSchema>>).validated.body;
  const size = await Size.create(body);
  await logAction(req, 'CREATE', 'SIZE', String(size._id), size.label);
  res.status(201).json({ size });
});

router.patch('/sizes/:id', writeLimiter, validate({ params: idSchema, body: sizeSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const size = await Size.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!size) throw notFound('Size nahi mila.');
  await logAction(req, 'UPDATE', 'SIZE', id, size.label);
  res.json({ size });
});

router.delete('/sizes/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const size = await Size.findByIdAndDelete(id);
  if (!size) throw notFound('Size nahi mila.');
  await logAction(req, 'DELETE', 'SIZE', id, size.label);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Coupons — 85.15                                                            */
/* ========================================================================== */

router.get('/coupons', readLimiter, async (_req: Request, res: Response) => {
  const items = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/coupons', writeLimiter, validate({ body: couponSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof couponSchema>>).validated.body;
  const coupon = await Coupon.create({ ...body, code: body.code.toUpperCase() });
  await logAction(req, 'CREATE', 'COUPON', String(coupon._id), coupon.code);
  res.status(201).json({ coupon });
});

router.patch('/coupons/:id', writeLimiter, validate({ params: idSchema, body: couponSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const coupon = await Coupon.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!coupon) throw notFound('Coupon nahi mila.');
  await logAction(req, 'UPDATE', 'COUPON', id, coupon.code);
  res.json({ coupon });
});

router.delete('/coupons/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const coupon = await Coupon.findByIdAndDelete(id);
  if (!coupon) throw notFound('Coupon nahi mila.');
  await logAction(req, 'DELETE', 'COUPON', id, coupon.code);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Banners — 85.13                                                            */
/* ========================================================================== */

router.get('/banners', readLimiter, async (_req: Request, res: Response) => {
  const items = await Banner.find().sort({ order: 1, createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/banners', writeLimiter, validate({ body: bannerSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof bannerSchema>>).validated.body;
  const banner = await Banner.create(body);
  await logAction(req, 'CREATE', 'BANNER', String(banner._id), banner.title);
  res.status(201).json({ banner });
});

router.patch('/banners/:id', writeLimiter, validate({ params: idSchema, body: bannerSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const banner = await Banner.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!banner) throw notFound('Banner nahi mila.');
  await logAction(req, 'UPDATE', 'BANNER', id, banner.title);
  res.json({ banner });
});

router.delete('/banners/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const banner = await Banner.findByIdAndDelete(id);
  if (!banner) throw notFound('Banner nahi mila.');
  await logAction(req, 'DELETE', 'BANNER', id, banner.title);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Offer popups — 85.14                                                       */
/* ========================================================================== */

router.get('/offer-popups', readLimiter, async (_req: Request, res: Response) => {
  const items = await OfferPopup.find()
    .sort({ order: 1, createdAt: -1 })
    .populate('productId', 'designId name slug images sellingPriceInr mrpInr type')
    .lean();
  res.json({ items });
});

router.post('/offer-popups', writeLimiter, validate({ body: offerPopupSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof offerPopupSchema>>).validated.body;
  const popup = await OfferPopup.create(body);
  await logAction(req, 'CREATE', 'OFFER_POPUP', String(popup._id), popup.offerType);
  res.status(201).json({ popup });
});

router.patch('/offer-popups/:id', writeLimiter, validate({ params: idSchema, body: offerPopupSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const popup = await OfferPopup.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!popup) throw notFound('Offer popup nahi mila.');
  await logAction(req, 'UPDATE', 'OFFER_POPUP', id, popup.offerType);
  res.json({ popup });
});

router.delete('/offer-popups/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const popup = await OfferPopup.findByIdAndDelete(id);
  if (!popup) throw notFound('Offer popup nahi mila.');
  await logAction(req, 'DELETE', 'OFFER_POPUP', id, String(popup.offerType));
  res.json({ ok: true });
});

/* ========================================================================== */
/* Pages / Content — 85.12                                                    */
/* ========================================================================== */

router.get('/pages', readLimiter, async (_req: Request, res: Response) => {
  const items = await Page.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/pages', writeLimiter, validate({ body: pageSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof pageSchema>>).validated.body;
  const page = await Page.create(body);
  await logAction(req, 'CREATE', 'PAGE', String(page._id), page.slug);
  res.status(201).json({ page });
});

router.patch('/pages/:id', writeLimiter, validate({ params: idSchema, body: pageSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const page = await Page.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!page) throw notFound('Page nahi mila.');
  await logAction(req, 'UPDATE', 'PAGE', id, page.slug);
  res.json({ page });
});

router.delete('/pages/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const page = await Page.findByIdAndDelete(id);
  if (!page) throw notFound('Page nahi mila.');
  await logAction(req, 'DELETE', 'PAGE', id, page.slug);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Homepage sections — 85.10–85.11                                            */
/* ========================================================================== */

// Equal `order` values (e.g. every preset used to save as 0) fall back to the
// storefront's natural flow: Ready to Buy → Customize → Upcoming → rest.
const SECTION_PRIORITY: Record<string, number> = {
  ready_to_buy: 0,
  customize: 1,
  new_designs: 2,
  trending: 3,
  featured: 4,
  showcase: 5,
};

function sortHomeSections<T extends { order: number; key: string }>(items: T[]): T[] {
  const priority = (key: string) => SECTION_PRIORITY[key] ?? 99;
  return items
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      if (a.section.order !== b.section.order) return a.section.order - b.section.order;
      const p = priority(a.section.key) - priority(b.section.key);
      if (p !== 0) return p;
      return a.index - b.index;
    })
    .map(({ section }) => section);
}

router.get('/homepage-sections', readLimiter, async (_req: Request, res: Response) => {
  const items = await HomepageSection.find().sort({ order: 1 }).lean();
  res.json({ items: sortHomeSections(items) });
});

router.post('/homepage-sections', writeLimiter, validate({ body: homepageSectionSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof homepageSectionSchema>>).validated.body;
  const section = await HomepageSection.create(body);
  await logAction(req, 'CREATE', 'HOME_SECTION', String(section._id), section.title);
  res.status(201).json({ section });
});

router.patch('/homepage-sections/:id', writeLimiter, validate({ params: idSchema, body: homepageSectionSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const section = await HomepageSection.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!section) throw notFound('Section nahi mila.');
  await logAction(req, 'UPDATE', 'HOME_SECTION', id, section.title);
  res.json({ section });
});

router.delete('/homepage-sections/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const section = await HomepageSection.findByIdAndDelete(id);
  if (!section) throw notFound('Section nahi mila.');
  await logAction(req, 'DELETE', 'HOME_SECTION', id, section.title);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Customers — 85.28                                                          */
/* ========================================================================== */

router.get('/customers', readLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { mobile: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  }
  const users = await User.find(filter).select('-refreshTokens').sort({ createdAt: -1 }).limit(300).lean();
  const userOrderStats = await Order.aggregate([
    { $match: { user: { $in: users.map((u) => u._id) } } },
    { $group: { _id: '$user', orderCount: { $sum: 1 }, totalSpentMinor: { $sum: '$amounts.totalMinor' }, lastOrderAt: { $max: '$placedAt' } } },
  ]);
  const statMap = new Map(userOrderStats.map((s) => [String(s._id), s]));
  const items = users.map((u) => {
    const s = statMap.get(String(u._id)) ?? { orderCount: 0, totalSpentMinor: 0, lastOrderAt: null };
    return { ...u, stats: s };
  });
  res.json({ items });
});

router.get('/customers/:id', readLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const user = await User.findById(id).select('-refreshTokens').lean();
  if (!user) throw notFound('Customer nahi mila.');
  const [orders, wishlistCount] = await Promise.all([
    Order.find({ user: id }).sort({ placedAt: -1 }).limit(100).lean(),
    (await import('../models/commerce.js')).Wishlist.findOne({ user: id }).select('products').lean(),
  ]);
  res.json({ user, orders, wishlistCount: wishlistCount?.products?.length ?? 0 });
});

router.patch('/customers/:id', writeLimiter, validate({
  params: idSchema,
  body: z.object({ isBlocked: z.boolean().optional(), name: z.string().max(80).optional() }).strict(),
}), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true }).select('-refreshTokens');
  if (!user) throw notFound('Customer nahi mila.');
  await logAction(req, body.isBlocked ? 'BLOCK' : 'UPDATE', 'CUSTOMER', id, user.mobile ?? user.name ?? id);
  res.json({ user });
});

/* ========================================================================== */
/* Reviews — 85.29                                                            */
/* ========================================================================== */

router.get('/reviews', readLimiter, async (req: Request, res: Response) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status)) ? String(req.query.status) : undefined;
  res.json({ items: await Review.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).populate('product', 'designId name').lean() });
});
router.patch('/reviews/:id/status', writeLimiter, validate({ params: idSchema, body: reviewStatusSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const { status } = (req as ValidatedRequest<{ status: string }>).validated.body;
  const review = await Review.findByIdAndUpdate(id, { $set: { status } }, { new: true });
  if (!review) throw notFound('Review nahi mila.');
  await logAction(req, `REVIEW_${status}`, 'REVIEW', id, status);
  res.json({ review });
});

/* ========================================================================== */
/* Measurements — 85.21–85.22                                                 */
/* ========================================================================== */

router.get('/measurements', readLimiter, async (_req: Request, res: Response) => res.json({ items: await MeasurementField.find().sort({ order: 1 }).lean() }));
router.post('/measurements', writeLimiter, validate({ body: measurementSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof measurementSchema>>).validated.body;
  const field = await MeasurementField.create(body);
  await logAction(req, 'CREATE', 'MEASUREMENT_FIELD', String(field._id), field.key);
  res.status(201).json({ field });
});
router.patch('/measurements/:id', writeLimiter, validate({ params: idSchema, body: measurementSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const field = await MeasurementField.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!field) throw notFound('Measurement field nahi mila.');
  await logAction(req, 'UPDATE', 'MEASUREMENT_FIELD', id, String(field.key));
  res.json({ field });
});
router.delete('/measurements/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const field = await MeasurementField.findByIdAndDelete(id);
  if (!field) throw notFound('Measurement field nahi mila.');
  await logAction(req, 'DELETE', 'MEASUREMENT_FIELD', id, String(field.key));
  res.json({ ok: true });
});

/* ========================================================================== */
/* Enquiries — WhatsApp & contact (85.30)                                     */
/* ========================================================================== */

router.get('/enquiries', readLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.channel) filter.channel = String(req.query.channel);
  const items = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(200).populate('product', 'designId name').lean();
  res.json({ items });
});

router.delete('/enquiries/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const enquiry = await Enquiry.findByIdAndDelete(id);
  if (!enquiry) throw notFound('Enquiry nahi mili.');
  await logAction(req, 'DELETE', 'ENQUIRY', id, '');
  res.json({ ok: true });
});

/* ========================================================================== */
/* Analytics — 85.2 deep drill / module 29                                    */
/* ========================================================================== */

router.get('/analytics/overview', readLimiter, async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const range = { $gte: from, $lte: to };
  const [eventBreakdown, topPages, topSearches, sourceBreakdown, deviceBreakdown, uniqueSessions] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.aggregate([{ $match: { at: range, type: 'PAGE_VIEW', path: { $ne: '' } } }, { $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    AnalyticsEvent.aggregate([{ $match: { at: range, type: 'SEARCH', query: { $ne: '' } } }, { $group: { _id: '$query', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$device.type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.distinct('sessionId', { at: range }),
  ]);
  res.json({ from, to, eventBreakdown, topPages, topSearches, sourceBreakdown, deviceBreakdown, uniqueSessions: uniqueSessions.length });
});

router.get('/analytics/products', readLimiter, async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const range = { $gte: from, $lte: to };
  const items = await Product.find().sort({ 'stats.views': -1 }).limit(100)
    .select('designId name type stats mrpInr sellingPriceInr isActive').lean();
  const eventCounts = await AnalyticsEvent.aggregate([
    { $match: { at: range, type: { $in: ['PRODUCT_VIEW', 'CART_ADD', 'WISHLIST_ADD', 'BUY_NOW', 'WHATSAPP_CLICK', 'SHARE'] }, product: { $ne: null } } },
    { $group: { _id: { product: '$product', type: '$type' }, count: { $sum: 1 } } },
  ]);
  const perProduct: Record<string, Record<string, number>> = {};
  for (const row of eventCounts) {
    const productId = String(row._id.product);
    (perProduct[productId] ??= {})[row._id.type] = row.count;
  }
  res.json({ items: items.map((p) => ({ ...p, events: perProduct[String(p._id)] ?? {} })) });
});

/* ========================================================================== */
/* Admin users & roles — 85.1 / module 31                                     */
/* ========================================================================== */

router.get('/admin-users', readLimiter, async (_req: Request, res: Response) => {
  const items = await User.find({ adminRoles: { $size: { $gte: 1 } } }).select('name mobile email adminRoles isBlocked lastLoginAt createdAt').lean();
  res.json({ items });
});

router.post('/admin-users', writeLimiter, validate({ body: userAdminSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof userAdminSchema>>).validated.body;
  const me = await User.findById(adminId(req)).lean();
  if (!me?.adminRoles?.includes('SUPER_ADMIN')) throw forbidden('Sirf Super Admin staff add kar sakta hai.');
  let user = await User.findOne({ mobile: body.mobile });
  if (!user) {
    user = await User.create({ mobile: body.mobile, mobileVerified: true, name: body.name });
  }
  user.adminRoles = body.roles as AdminRole[];
  await user.save();
  await logAction(req, 'ASSIGN_ROLES', 'ADMIN_USER', String(user._id), `${body.mobile}: ${body.roles.join(', ')}`);
  res.status(201).json({ user });
});

router.patch('/admin-users/:id', writeLimiter, validate({
  params: idSchema,
  body: z.object({
    roles: z.array(z.enum([...ADMIN_ROLES] as [AdminRole, ...AdminRole[]])).optional(),
    isBlocked: z.boolean().optional(),
    name: z.string().max(80).optional(),
  }).strict(),
}), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  if (id === adminId(req) && body.isBlocked === true) throw conflict('Aap khud ko block nahi kar sakte.');
  const me = await User.findById(adminId(req)).lean();
  if (!me?.adminRoles?.includes('SUPER_ADMIN')) throw forbidden('Sirf Super Admin roles change kar sakta hai.');
  const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true }).select('name mobile email adminRoles isBlocked');
  if (!user) throw notFound('Staff member nahi mila.');
  await logAction(req, 'UPDATE_STAFF', 'ADMIN_USER', id, `${user.mobile}: ${JSON.stringify(body)}`);
  res.json({ user });
});

router.delete('/admin-users/:id', writeLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  if (id === adminId(req)) throw conflict('Aap khud ko remove nahi kar sakte.');
  const me = await User.findById(adminId(req)).lean();
  if (!me?.adminRoles?.includes('SUPER_ADMIN')) throw forbidden('Sirf Super Admin staff remove kar sakta hai.');
  const user = await User.findByIdAndUpdate(id, { $set: { adminRoles: [] } }, { new: true });
  if (!user) throw notFound('Staff member nahi mila.');
  await logAction(req, 'REMOVE_STAFF', 'ADMIN_USER', id, user.mobile ?? id);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Settings — 85.32                                                           */
/* ========================================================================== */

router.get('/settings', readLimiter, async (_req: Request, res: Response) => res.json({ items: await Setting.find().sort({ key: 1 }).lean() }));
router.put('/settings/:key', writeLimiter, validate({ body: settingSchema }), async (req: Request, res: Response) => {
  const key = String(req.params.key).trim().slice(0, 60);
  const setting = await Setting.findOneAndUpdate({ key }, { $set: { value: (req as ValidatedRequest<{ value: unknown }>).validated.body.value, updatedBy: adminId(req) } }, { upsert: true, new: true });
  invalidateSettingsCache();
  await logAction(req, 'UPDATE', 'SETTING', key, key);
  res.json({ setting });
});

/* ========================================================================== */
/* Activity log — 85.34                                                       */
/* ========================================================================== */

router.get('/activity', readLimiter, async (_req: Request, res: Response) => res.json({ items: await AdminActivityLog.find().sort({ at: -1 }).limit(200).lean() }));

/* ========================================================================== */
/* Backups & export — 85.35–85.36                                             */
/* ========================================================================== */

router.get('/export/products', readLimiter, async (_req: Request, res: Response) => res.json({ items: await Product.find().lean() }));
router.get('/export/orders', readLimiter, async (_req: Request, res: Response) => res.json({ items: await Order.find().sort({ placedAt: -1 }).limit(500).lean() }));
router.get('/export/customers', readLimiter, async (_req: Request, res: Response) => res.json({ items: await User.find().select('-refreshTokens').lean() }));
router.get('/export/inventory', readLimiter, async (_req: Request, res: Response) => {
  const [fabrics, laces, latkans, products] = await Promise.all([
    Fabric.find().select('name material colorName stockMeters inStock slug').lean(),
    Lace.find().select('name colorName inStock slug priceInr').lean(),
    Latkan.find().select('name colorName inStock slug priceInr').lean(),
    Product.find({ type: 'READY_MADE' }).select('designId name variants colors sizes').lean(),
  ]);
  res.json({ items: { fabrics, laces, latkans, products } });
});

export default router;