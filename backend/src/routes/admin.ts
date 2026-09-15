import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { adminReadLimiter, adminWriteLimiter } from '../middleware/rateLimit.js';
import { Category, Fabric, Lace, Latkan, Product } from '../models/catalog.js';
import { Coupon, Enquiry, Order, Review } from '../models/commerce.js';
import { MeasurementField, User } from '../models/user.js';
import { Tailor } from '../models/tailor.js';
import { AdminActivityLog, AnalyticsEvent, Setting } from '../models/analytics.js';
import { Color, Size, Banner, OfferPopup, Page, HomepageSection } from '../models/admin-content.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { ORDER_STATUSES, PAYMENT_STATUSES, ADMIN_ROLES, TAILOR_SPECIALIZATIONS, TAILOR_STATUSES, COMPLEXITY_KEYS, type AdminRole, type OrderStatus, type ComplexityKey, type TailorSpecialization, type TailorStatus } from '../domain/constants.js';
import { notFound, forbidden, badRequest, conflict } from '../utils/errors.js';
import { invalidateSettingsCache } from '../services/settings.js';
import { computeEstimate, detectComplexity, complexitySpecialization, dailyCapacityFor, activeWorkload, tailorWorkloads, pendingWorkload, awaitingTailorCount, getProductionConfig } from '../services/production.js';
import { createRefund, fetchRefund, refundLifecycle } from '../services/payment/razorpay.js';
import { notifyOrderCancellation } from '../services/notifications.js';
import { pushToShiprocket, releaseStockForOrder } from './orders.js';
import { mobileSchema } from './auth.js';
import { uploadImage, MAX_UPLOAD_BYTES } from '../services/media/cloudinary.js';
import { generateLatkanSuggestion, generateFabricSuggestion, generateLaceSuggestion, generateProductSuggestions } from '../services/ai/qwen.js';
import { env, integrations, shiprocketMock, whatsapp } from '../config/env.js';
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
import { MessageLog, WaCampaign } from '../models/whatsapp.js';
import { MESSAGE_TYPES } from '../services/whatsapp/constants.js';
import { getWhatsAppSettings, updateWhatsAppSettings } from '../services/whatsapp/settings.js';
import { TEMPLATE_REGISTRY, buildComponents } from '../services/whatsapp/templates.js';
import { enqueueWhatsApp } from '../services/whatsapp/queue.js';
import { notifyOrderEvent } from '../services/whatsapp/notify.js';
import { sendCampaign, targetsForCampaign } from '../services/whatsapp/marketing.js';
import { recordWebhookReceipt } from './webhooks.js';

const router = Router();

export function shouldBlockOrderStatusMutation(order: {
  status?: string;
  cancellation?: { refund?: { status?: string | null } | null } | null;
}): boolean {
  return order.status === 'CANCELLED'
    && !!order.cancellation?.refund?.status
    && order.cancellation.refund.status !== 'COMPLETED';
}

const idSchema = z.object({ id: z.string().trim().min(1).max(80) }).strict();
const orderNumberSchema = z.object({ orderNumber: z.string().trim().min(6).max(30) }).strict();
const statusSchema = z.object({ status: z.enum([...ORDER_STATUSES] as [OrderStatus, ...OrderStatus[]]), note: z.string().trim().max(200).default('') }).strict();
const reviewStatusSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']) }).strict();
const settingSchema = z.object({ value: z.unknown() }).strict();

const tailorSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mobile: z.string().trim().max(20).default(''),
    email: z.string().trim().email().max(120).default('').or(z.literal('')),
    address: z.string().trim().max(300).default(''),
    specializationCaps: z
      .array(z.object({ code: z.enum([...TAILOR_SPECIALIZATIONS] as [TailorSpecialization, ...TailorSpecialization[]]), capacityPerDay: z.number().min(0.5).max(20) }))
      .max(12)
      .default([]),
    experienceYears: z.number().int().min(0).max(60).default(0),
    workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
    workingHours: z.string().trim().max(40).default('10:00–18:00'),
    status: z.enum([...TAILOR_STATUSES] as [TailorStatus, ...TailorStatus[]]).default('ACTIVE'),
    notes: z.string().max(1000).default(''),
  })
  .strict();

const confirmOrderSchema = z
  .object({
    reviewNote: z.string().trim().max(500).default(''),
    complexity: z.enum([...COMPLEXITY_KEYS] as [ComplexityKey, ...ComplexityKey[]]).optional(),
    estimatedDeliveryAt: z.coerce.date().nullable().optional(),
  })
  .strict();

const cancelOrderSchema = z.object({ reason: z.string().trim().min(1).max(400) }).strict();

const assignTailorSchema = z
  .object({
    tailorId: z.string().trim().min(1).max(30),
    notes: z.string().trim().max(500).default(''),
    reason: z.string().trim().max(300).default(''),
  })
  .strict();

const productionPatchSchema = z.object({ complexity: z.enum([...COMPLEXITY_KEYS] as [ComplexityKey, ...ComplexityKey[]]) }).strict();

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

/**
 * Staff are identified by mobile (OTP login) or email (Google login), so either
 * one is enough — but at least one is required, otherwise the account would
 * have no way to sign in and claim its roles. Blank strings from the form are
 * treated as "not supplied" rather than as an invalid value.
 */
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const userAdminSchema = z.object({
  mobile: z.preprocess(blankToUndefined, mobileSchema.optional()),
  email: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().email().max(160).optional()),
  name: z.string().trim().max(80).default(''),
  roles: z.array(z.enum([...ADMIN_ROLES] as [AdminRole, ...AdminRole[]])).min(1),
}).strict().refine(
  (body) => Boolean(body.mobile || body.email),
  { message: 'Mobile number ya email — kam se kam ek zaroori hai.', path: ['mobile'] },
);

export const productSchemaBase = z.object({
  designId: z.string().trim().max(24).optional(),
  slug: z.preprocess((value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) : value, z.string().max(60).optional()),
  name: z.string().trim().max(140).default(''), description: z.string().max(4000).default(''),
  type: z.enum(['READY_MADE', 'CUSTOMIZE', 'BOTH', 'SHOWCASE']).default('CUSTOMIZE'), category: z.string().trim().optional(),
  subCategory: z.string().nullable().optional(), tags: z.array(z.string().max(60)).default([]),
  mrpInr: z.number().min(0).optional(), sellingPriceInr: z.number().min(0).optional(), codInitialPaymentPercent: z.number().int().min(0).max(100).default(0), images: z.array(z.unknown()).default([]),
  videoUrl: z.string().max(500).default(''), colors: z.array(z.unknown()).default([]), sizes: z.array(z.number()).default([]),
  variants: z.array(z.unknown()).default([]), fabricOptions: z.array(z.string()).default([]), laceOptions: z.array(z.string()).default([]),
  latkanOptions: z.array(z.string()).default([]),
  minFabricCount: z.number().int().min(1).max(6).default(1), maxFabricCount: z.number().int().min(1).max(6).default(1),
  minLaceCount: z.number().int().min(0).max(6).default(1), maxLaceCount: z.number().int().min(0).max(6).default(1),
  minLatkanCount: z.number().int().min(0).max(6).default(1), maxLatkanCount: z.number().int().min(0).max(6).default(1),
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

export const withValidProductRanges = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value: unknown, ctx) => {
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

export const productSchema = withValidProductRanges(
  productSchemaBase.extend({
    sellingPriceInr: z.number().min(0),
    images: z.array(z.unknown()).min(1, 'Kam se kam ek image add karein.'),
  }),
);
export const productPatchSchema = withValidProductRanges(productSchemaBase.partial());

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

router.post('/upload', adminWriteLimiter, runImageUpload, async (req: Request, res: Response) => {
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

router.get('/dashboard', adminReadLimiter, async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const range = { $gte: from, $lte: to };
  const [products, orders, customers, events, revenue, statuses, topProducts, cartEvents, wishlistEvents, whatsappEnquiries, lowStockProducts, failedPayments, alerts] = await Promise.all([
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
    Promise.all([
      Order.countDocuments({ status: 'AWAITING_REVIEW' }).then((n) => ({ key: 'awaitingReview', label: 'Awaiting review', count: n, status: 'AWAITING_REVIEW' })),
      awaitingTailorCount().then((n) => ({ key: 'unassigned', label: 'Confirmed, no tailor', count: n, status: 'CONFIRMED' })),
      Order.countDocuments({ 'cancellation.refund.status': 'FAILED' }).then((n) => ({ key: 'refundFailed', label: 'Refund failed', count: n, status: 'CANCELLED' })),
      dailyCapacityFor('simple_blouse').then(async (capacity) => {
        const pending = await pendingWorkload();
        const highWorkload = capacity > 0 && pending.units + pending.orders > capacity * 14;
        return { key: 'highWorkload', label: 'High stitching workload', count: highWorkload ? pending.units : 0, status: 'CONFIRMED' };
      }),
    ]),
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
    alerts: alerts.filter((alert) => alert.count > 0),
  });
});

/* ========================================================================== */
/* Order risk helpers (review-first workflow)                                 */
/* ========================================================================== */

interface CustomerStatsRow {
  recent: number;
  cancelled: number;
}

interface OrderRecord {
  _id?: string;
  orderNumber?: string;
  status?: string;
  isGuest?: boolean;
  placedAt?: Date | string;
  contact?: { mobile?: string; name?: string } | null;
  payment?: { method?: string; status?: string } | null;
  address?: { country?: string } | null;
  items?: Array<{ _id?: unknown; product?: string; type?: string; quantity?: number }>;
  production?: { complexity?: string; productionUnits?: number; estimatedWorkingDays?: number } | null;
  tailor?: { tailorName?: string; status?: string; assignedAt?: Date | string } | null;
  cancellation?: {
    refund?: { status?: string; razorpayRefundId?: string; amountMinor?: number } | null;
    reason?: string;
  } | null;
  deliveryEstimate?: { fromDate?: Date | string | null; toDate?: Date | string | null; stitchingWorkingDays?: number } | null;
}

const REVIEW_FLAG_LABELS: Record<string, string> = {
  UNPAID: 'Online payment abhi nahi hui',
  GUEST: 'Guest checkout',
  MULTIPLE_RECENT: '30 din mein kai orders',
  PREVIOUS_CANCELLED: 'Pehle ka order cancel hua tha',
  CODE_PAYMENT_ISSUE: 'Payment status unusual',
  OUTSIDE_INDIA: 'Delivery address India ke bahar',
};

/** Risk signals for an order, given its 30-day customer history. */
function riskFlagsFor(order: OrderRecord, stats: CustomerStatsRow | undefined): string[] {
  const flags: string[] = [];
  const payment = order.payment;
  if (payment?.method === 'RAZORPAY' && payment.status !== 'PAID') flags.push('UNPAID');
  if (payment?.method === 'COD' && !['COD_PENDING', 'COD_ADVANCE_PENDING', 'COD_ADVANCE_PAID'].includes(payment.status ?? '')) {
    flags.push('CODE_PAYMENT_ISSUE');
  }
  if (order.isGuest) flags.push('GUEST');
  const previous = Math.max((stats?.recent ?? 1) - 1, 0);
  if (previous >= 3) flags.push('MULTIPLE_RECENT');
  if ((stats?.cancelled ?? 0) > 0) flags.push('PREVIOUS_CANCELLED');
  if (order.address && !['IN', 'BD', 'PK', 'NP', 'BT', 'LK'].includes(order.address.country ?? '')) flags.push('OUTSIDE_INDIA');
  return flags;
}

/** 30-day order history per mobile, in one query for a whole admin page. */
async function customerStatsMap(mobiles: string[]): Promise<Map<string, CustomerStatsRow>> {
  const unique = [...new Set(mobiles.filter((m) => m && m.length > 0))];
  if (unique.length === 0) return new Map();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await Order.aggregate<{ _id: string; recent: number; cancelled: number }>([
    {
      $match: { placedAt: { $gte: since }, 'contact.mobile': { $in: unique } },
    },
    {
      $group: {
        _id: '$contact.mobile',
        recent: { $sum: 1 },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
      },
    },
  ]);
  const map = new Map<string, CustomerStatsRow>();
  for (const row of rows) map.set(String(row._id), { recent: row.recent, cancelled: row.cancelled });
  return map;
}

/**
 * Enriches a lean order document with review risk + customer history. The
 * `detailed` flag also resolves category names for the item list (one
 * additional pair of queries, used only for the detail modal).
 */
async function enrichAdminOrder(
  doc: OrderRecord,
  opts: { stats?: CustomerStatsRow; detailed?: boolean } = {},
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = { ...doc };
  const flags = riskFlagsFor(doc, opts.stats);
  const previous = Math.max((opts.stats?.recent ?? 1) - 1, 0);
  const cancelledIncludingCurrent = opts.stats?.cancelled ?? 0;
  enriched.risk = {
    flags,
    flagLabels: flags.map((flag) => REVIEW_FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')),
    reviewRecommended: flags.length > 0,
  };
  enriched.customerStats = {
    previousOrders: previous,
    previousCancelled: Math.max(cancelledIncludingCurrent - (doc.status === 'CANCELLED' ? 1 : 0), 0),
  };

  if (opts.detailed) {
    const itemProducts = (doc.items ?? []).map((item) => item.product).filter(Boolean);
    const products = await Product.find({ _id: { $in: itemProducts } }).select('category name designId').lean();
    const categoryIds = [...new Set(products.map((p) => String(p.category)).filter(Boolean))];
    const categories = categoryIds.length ? await Category.find({ _id: { $in: categoryIds } }).select('name').lean() : [];
    const categoryNameById = new Map(categories.map((c) => [String(c._id), c.name]));
    const productById = new Map(products.map((p) => [String(p._id), p]));
    enriched.itemCategories = (doc.items ?? []).map((item) => {
      const product = productById.get(String(item.product));
      return product ? categoryNameById.get(String((product as { category?: unknown }).category)) ?? '' : '';
    });
  }

  return enriched;
}

/* ========================================================================== */
/* Orders — 85.19–85.23                                                       */
/* ========================================================================== */

router.get('/orders', adminReadLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  const requestedStatus = String(req.query.status ?? '');
  if (requestedStatus && ORDER_STATUSES.includes(requestedStatus as OrderStatus)) {
    filter.status = requestedStatus;
    // Awaiting review = sirf paid (Razorpay) ya COD_PENDING orders.
    if (requestedStatus === 'AWAITING_REVIEW') filter['payment.status'] = { $in: ['PAID', 'COD_PENDING'] };
  }
  const paymentFilter = String(req.query.payment ?? '');
  if (paymentFilter && (PAYMENT_STATUSES as readonly string[]).includes(paymentFilter)) filter['payment.status'] = paymentFilter;
  if (req.query.q) {
    const q = String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (q) filter.$or = [{ orderNumber: new RegExp(q, 'i') }, { 'contact.name': new RegExp(q, 'i') }, { 'contact.mobile': new RegExp(q, 'i') }];
  }
  if (req.query.from || req.query.to) {
    const range: Record<string, Date> = {};
    if (req.query.from) range.$gte = new Date(String(req.query.from));
    if (req.query.to) range.$lte = new Date(String(req.query.to));
    filter.placedAt = range;
  }

  // Extra filters for the review workflow.
  const tailorFilter = String(req.query.tailor ?? '');
  if (tailorFilter === 'unassigned') {
    // Confirmed-and-waiting-for-a-tailor shortcut.
    filter.status = 'CONFIRMED';
    filter['tailor.status'] = { $ne: 'ASSIGNED' };
  } else if (tailorFilter === 'assigned') {
    filter['tailor.status'] = 'ASSIGNED';
  }

  const reviewFilter = String(req.query.review ?? '');
  if (reviewFilter === 'pending') filter['review.status'] = 'PENDING';
  else if (reviewFilter === 'approved') filter['review.status'] = 'APPROVED';
  else if (reviewFilter === 'rejected') filter['review.status'] = 'REJECTED';

  const refundFilter = String(req.query.refund ?? '');
  if (refundFilter === 'pending') {
    filter.status = 'CANCELLED';
    filter['cancellation.refund.status'] = { $in: ['PENDING', 'PROCESSING'] };
  } else if (refundFilter === 'failed') {
    filter.status = 'CANCELLED';
    filter['cancellation.refund.status'] = 'FAILED';
  } else if (refundFilter === 'refunded') {
    filter.status = 'CANCELLED';
    filter['cancellation.refund.status'] = 'COMPLETED';
  }

  const docs = await Order.find(filter).sort({ placedAt: -1 }).limit(300).select('-__v').lean();
  const mobiles = docs.map((doc) => (doc.contact as { mobile?: string } | undefined)?.mobile ?? '');
  const statsMap = await customerStatsMap(mobiles);
  const items = docs.map((doc) =>
    enrichAdminOrder(doc as unknown as OrderRecord, { stats: statsMap.get((doc.contact as { mobile?: string } | undefined)?.mobile ?? '') }),
  );
  res.json({ items: await Promise.all(items) });
});

router.get('/orders/search', adminReadLimiter, async (_req: Request, res: Response) => res.json({ ok: true }));

router.get('/orders/:orderNumber', adminReadLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber }).lean();
  if (!order) throw notFound('Order nahi mila.');

  const live = await activeWorkload(String(order._id));
  const stats = await customerStatsMap([(order.contact as { mobile?: string } | undefined)?.mobile ?? '']);
  const enriched = await enrichAdminOrder(order as unknown as OrderRecord, {
    stats: stats.get((order.contact as { mobile?: string } | undefined)?.mobile ?? ''),
    detailed: true,
  });
  enriched.liveWorkload = {
    activeUnits: live.units,
    activeOrders: live.orderCount,
    dailyCapacity: await dailyCapacityFor(
      complexitySpecialization(((order as unknown as OrderRecord).production?.complexity as ComplexityKey) ?? 'medium'),
    ),
  };
  res.json({ order: enriched });
});

router.patch('/orders/:orderNumber/status', adminWriteLimiter, validate({ params: orderNumberSchema, body: statusSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const { status, note } = (req as ValidatedRequest<{ status: OrderStatus; note: string }>).validated.body;
  if (status === 'CONFIRMED' || status === 'CANCELLED') {
    throw badRequest('Confirm/cancel dedicated flow se karein (review controls).');
  }
  // Validate constraints BEFORE persisting anything — an invalid transition
  // must not survive a thrown error from the constraints check.
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (shouldBlockOrderStatusMutation(order)) {
    throw badRequest('Cancelled order modify nahi ho sakta jab tak refund settle na ho.');
  }
  order.status = status;
  order.statusHistory.push({ status, note, at: new Date() });
  await order.save();
  await logAction(req, 'UPDATE_STATUS', 'ORDER', orderNumber, `${orderNumber} -> ${status}${note ? ` (${note})` : ''}`);
  res.json({ order });
});

router.patch('/orders/:orderNumber/shipping', adminWriteLimiter, validate({
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

/** Admin-set confirmed delivery date — customer tracking par directly dikhti hai. */
router.patch('/orders/:orderNumber/promised-delivery', adminWriteLimiter, validate({
  params: orderNumberSchema,
  body: z.object({ estimatedDeliveryAt: z.coerce.date().nullable().optional() }).strict(),
}), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const body = (req as ValidatedRequest<{ estimatedDeliveryAt?: Date | null }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (body.estimatedDeliveryAt !== undefined) order.set('promisedDeliveryAt', body.estimatedDeliveryAt as Date | null);
  await order.save();
  await logAction(req, 'UPDATE_DELIVERY_PROMISE', 'ORDER', orderNumber, `Promised delivery set for ${orderNumber}`);
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ order: fresh });
});

/* ========================================================================== */
/* Order review workflow — confirm / cancel / tailor / production / refund     */
/* ========================================================================== */

const objectIdParamSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }).strict();

/** Highest-severity complexity across the order's products (a suggestion). */
async function detectOrderComplexity(order: InstanceType<typeof Order>): Promise<ComplexityKey> {
  const ids = order.items.map((item) => item.product).filter(Boolean);
  if (ids.length === 0) return 'medium';
  const products = await Product.find({ _id: { $in: ids } }).select('name embroidery tags').lean();
  const severity: Record<ComplexityKey, number> = { simple: 1, medium: 2, designer: 3, heavy_designer: 4, bridal: 5 };
  let best: ComplexityKey = 'medium';
  for (const product of products) {
    const detected = detectComplexity(product);
    if (severity[detected] > severity[best]) best = detected;
  }
  return best;
}

/**
 * Recomputes the production + delivery-estimate snapshots. The workload math
 * always excludes this order itself (it is being added, not double-counted).
 */
async function applyProductionEstimate(order: InstanceType<typeof Order>, complexity: ComplexityKey): Promise<void> {
  const cfg = await getProductionConfig();
  const estimate = await computeEstimate({
    items: order.items.map((item) => ({
      type: (item.type as 'CUSTOMIZE' | 'READY_MADE') ?? 'READY_MADE',
      quantity: item.quantity ?? 1,
    })),
    complexity,
    fallbackStitchingDays: order.production?.estimatedWorkingDays ?? 7,
    excludeOrderId: String(order._id),
  });
  const hasCustom = order.items.some((item) => item.type === 'CUSTOMIZE');
  order.set('production', {
    complexity,
    productionUnits: estimate.productionUnits,
    estimatedWorkingDays: estimate.estimate.stitchingWorkingDays,
    calculatedAt: new Date(),
  });
  order.set('deliveryEstimate', {
    stitchingWorkingDays: estimate.estimate.stitchingWorkingDays,
    packingWorkingDays: estimate.estimate.packingWorkingDays,
    shippingDays: estimate.estimate.shippingDays,
    bufferDays: cfg.bufferWorkingDays,
    fromDate: estimate.estimate.fromDate,
    toDate: estimate.estimate.toDate,
    workingDaysUsed: Math.max(
      1,
      estimate.estimate.stitchingWorkingDays + cfg.packingWorkingDays + (hasCustom ? cfg.bufferWorkingDays : 0),
    ),
    calculatedAt: new Date(),
  });
}

/**
 * Idempotent (per-order state machine) Razorpay refund for a cancelled order.
 * Returns 'already' when a refund is in flight / settled, 'none' when nothing
 * was paid, otherwise 'requested' / 'failed'. FAILED orders can be retried.
 */
async function issueRefund(order: InstanceType<typeof Order>): Promise<'requested' | 'already' | 'failed' | 'none'> {
  const refund = (order.cancellation?.refund ?? {}) as { status?: string; attempts?: number; razorpayRefundId?: string };
  if (['PENDING', 'PROCESSING', 'COMPLETED'].includes(refund.status ?? '')) return 'already';
  const payment = (order.payment ?? {}) as { method?: string; status?: string; razorpayPaymentId?: string };
  if (!payment.razorpayPaymentId) return 'none';
  const paidAmount = payment.status === 'PAID' ? order.amounts.totalMinor : payment.status === 'COD_ADVANCE_PAID' ? order.amounts.codAdvanceMinor : 0;
  if (paidAmount <= 0) return 'none';

  const attempts = (refund.attempts ?? 0) + 1;
  try {
    const refundObj = await createRefund(payment.razorpayPaymentId, paidAmount);
    order.set('cancellation.refund', {
      status: refundObj.id ? 'PROCESSING' : 'PENDING',
      razorpayRefundId: refundObj.id ?? '',
      amountMinor: paidAmount,
      requestedAt: new Date(),
      completedAt: null,
      failureReason: '',
      attempts,
    });
    await order.save();
    return 'requested';
  } catch (err) {
    order.set('cancellation.refund', {
      status: 'FAILED',
      razorpayRefundId: refund.razorpayRefundId ?? '',
      amountMinor: paidAmount,
      requestedAt: order.cancellation?.refund?.requestedAt ?? null,
      completedAt: null,
      failureReason: (err as Error).message.slice(0, 300),
      attempts,
    });
    await order.save();
    return 'failed';
  }
}

/** Confirm an AWAITING_REVIEW order: APPROVED review + CONFIRMED + estimate. */
router.post('/orders/:orderNumber/confirm', adminWriteLimiter, validate({ params: orderNumberSchema, body: confirmOrderSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const body = (req as ValidatedRequest<{ reviewNote: string; complexity?: ComplexityKey; estimatedDeliveryAt?: Date | null }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (order.status !== 'AWAITING_REVIEW') throw badRequest('Sirf AWAITING_REVIEW order confirm ho sakta hai.');

  const complexity = body.complexity ?? (order.production?.complexity as ComplexityKey | undefined) ?? (await detectOrderComplexity(order));
  await applyProductionEstimate(order, complexity);

  if (body.estimatedDeliveryAt !== undefined) order.set('promisedDeliveryAt', body.estimatedDeliveryAt as Date | null);

  order.set('review', {
    status: 'APPROVED',
    reviewedBy: (req as Request & { user?: { _id?: unknown } }).user?._id ?? null,
    reviewedAt: new Date(),
    reviewNote: body.reviewNote,
    flags: (order.review?.flags as string[] | undefined) ?? [],
  });
  order.status = 'CONFIRMED';
  order.statusHistory.push({ status: 'CONFIRMED', at: new Date(), note: 'Review approved — production + delivery estimated' });

  await order.save();
  // Shiprocket auto-create gated inside pushToShiprocket (settings.autoCreate).
  void pushToShiprocket(String(order._id));
  // Order confirmation message (order number + payment + track link) via WhatsApp.
  void notifyOrderEvent(order, 'ORDER_CONFIRMED');
  await logAction(req, 'CONFIRM_ORDER', 'ORDER', orderNumber, `${orderNumber} confirmed (complexity → ${complexity})`);

  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh });
});

/** Cancel an order: REJECTED review + CANCELLED + optional refund + SMS. */
router.post('/orders/:orderNumber/cancel', adminWriteLimiter, validate({ params: orderNumberSchema, body: cancelOrderSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const { reason } = (req as ValidatedRequest<{ reason: string }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');

  if (order.status === 'CANCELLED') {
    const fresh = await Order.findOne({ orderNumber });
    res.json({ order: fresh, alreadyCancelled: true });
    return;
  }
  if (!['AWAITING_REVIEW', 'CONFIRMED'].includes(order.status)) {
    throw badRequest('Is status se cancel allowed nahi hai (shipping ke baad nahi).');
  }

  const paymentStatusAtCancel = order.payment.status;
  const mobile = order.contact.mobile ?? '';
  const refundText = paymentStatusAtCancel === 'PAID' ? `Rs${(order.amounts.totalMinor / 100).toLocaleString('en-IN')}` : paymentStatusAtCancel === 'COD_ADVANCE_PAID' ? `Rs${(order.amounts.codAdvanceMinor / 100).toLocaleString('en-IN')}` : '';

  order.status = 'CANCELLED';
  order.statusHistory.push({ status: 'CANCELLED', at: new Date(), note: `Cancelled by admin: ${reason}` });
  order.set('review', {
    status: 'REJECTED',
    reviewedBy: (req as Request & { user?: { _id?: unknown } }).user?._id ?? null,
    reviewedAt: new Date(),
    reviewNote: `Cancelled — ${reason}`,
    flags: (order.review?.flags as string[] | undefined) ?? [],
  });
  order.set('cancellation', {
    cancelledBy: (req as Request & { user?: { _id?: unknown } }).user?._id ?? null,
    cancelledByLabel: 'admin',
    cancelledAt: new Date(),
    reason,
    paymentStatusAtCancel,
    refund: { status: 'NONE', razorpayRefundId: '', amountMinor: 0, requestedAt: null, completedAt: null, failureReason: '', attempts: 0 },
    notificationStatus: 'NOT_SENT',
    notificationMessage: '',
  });
  await order.save();

  // Reserved ready-made stock held since checkout is released on cancel —
  // otherwise cancelled orders would silently keep tying up inventory.
  await releaseStockForOrder(order);

  const refundOutcome = await issueRefund(order);

  const notification = await notifyOrderCancellation({ mobile, orderNumber, reason, refundText });
  order.set('cancellation.notificationStatus', notification.ok ? 'SENT' : 'FAILED');
  order.set('cancellation.notificationMessage', notification.message.slice(0, 700));
  await order.save();

  await logAction(req, 'CANCEL_ORDER', 'ORDER', orderNumber, `${orderNumber} cancelled: ${reason} (refund=${refundOutcome})`);

  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh, refund: refundOutcome });
});

/** Manual tailor assignment / reassignment (history preserved). */
router.post('/orders/:orderNumber/assign-tailor', adminWriteLimiter, validate({ params: orderNumberSchema, body: assignTailorSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const body = (req as ValidatedRequest<{ tailorId: string; notes: string; reason: string }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (!['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'].includes(order.status)) {
    throw badRequest('Confirm ho-chuki order par hi tailor assign hota hai.');
  }
  const tailor = await Tailor.findById(body.tailorId).lean();
  if (!tailor) throw notFound('Tailor nahi mila.');

  const current = order.tailor ?? {};
  const history = [...((current.history ?? []) as unknown as Array<{ tailorId: unknown; tailorName: string; assignedBy: unknown; at: Date; reason?: string }>)];
  const reAssign = current.tailorId && String(current.tailorId) !== body.tailorId;
  if (reAssign) {
    history.push({
      tailorId: current.tailorId ?? null,
      tailorName: current.tailorName ?? '',
      assignedBy: current.assignedBy ?? null,
      at: current.assignedAt ?? new Date(),
      reason: `Replaced by ${tailor.name}${body.reason ? ` — ${body.reason}` : ''}`,
    });
  }
  history.push({
    tailorId: tailor._id,
    tailorName: tailor.name,
    assignedBy: (req as Request & { user?: { _id?: unknown } }).user?._id ?? null,
    at: new Date(),
    reason: body.reason || (reAssign ? 'Reassign' : 'Assign'),
  });

  order.set('tailor', {
    tailorId: tailor._id,
    tailorName: tailor.name,
    assignedBy: (req as Request & { user?: { _id?: unknown } }).user?._id ?? null,
    assignedAt: new Date(),
    status: 'ASSIGNED',
    notes: body.notes,
    history,
  });
  await order.save();
  await logAction(req, 'ASSIGN_TAILOR', 'ORDER', orderNumber, `${orderNumber} -> ${tailor.name}`);

  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh });
});

/** Override the per-order complexity; delivery estimate is recomputed. */
router.patch('/orders/:orderNumber/production', adminWriteLimiter, validate({ params: orderNumberSchema, body: productionPatchSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const { complexity } = (req as ValidatedRequest<{ complexity: ComplexityKey }>).validated.body;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (order.status === 'CANCELLED') throw badRequest('Cancelled order ka production update nahi hota.');

  await applyProductionEstimate(order, complexity);
  await order.save();
  await logAction(req, 'UPDATE_PRODUCTION', 'ORDER', orderNumber, `${orderNumber} complexity → ${complexity}`);

  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh, message: 'Estimate recomputed.' });
});

/** Retry a FAILED refund (idempotent; only useful when the provider failed). */
router.post('/orders/:orderNumber/refund/retry', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  if (order.status !== 'CANCELLED') throw badRequest('Cancelled order ka refund hi retry hota hai.');
  if ((order.cancellation?.refund?.status ?? 'NONE') !== 'FAILED') throw badRequest('Refund FAILED state mein hi retry hota hai.');
  const outcome = await issueRefund(order);
  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh, refund: outcome });
});

/** Re-sync refund state straight from Razorpay. */
router.post('/orders/:orderNumber/refund/sync', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  const order = await Order.findOne({ orderNumber });
  if (!order) throw notFound('Order nahi mila.');
  const refundId = order.cancellation?.refund?.razorpayRefundId;
  if (!refundId) throw badRequest('Refund request nahi mila.');

  let refundStatus = 'pending';
  try {
    const refundObj = await fetchRefund(refundId);
    refundStatus = refundObj.status ?? 'pending';
  } catch (err) {
    throw badRequest(`Refund fetch fail: ${(err as Error).message.slice(0, 200)}`);
  }

  const settled = refundLifecycle(refundStatus);
  if (settled === 'COMPLETED') {
    order.set('cancellation.refund.status', 'COMPLETED');
    order.set('cancellation.refund.completedAt', new Date());
    order.set('payment.status', 'REFUNDED');
  } else {
    order.set('cancellation.refund.status', settled);
    if (settled === 'FAILED') order.set('cancellation.refund.failureReason', 'Provider reported failure.');
  }
  await order.save();
  await logAction(req, 'SYNC_REFUND', 'ORDER', orderNumber, `${orderNumber} refund → ${settled}`);

  const fresh = await Order.findOne({ orderNumber });
  res.json({ order: fresh });
});

/* ========================================================================== */
/* Tailors — CRUD + production dashboard                                      */
/* ========================================================================== */

router.get('/tailors', adminReadLimiter, async (_req: Request, res: Response) => {
  const [tailors, workloads] = await Promise.all([Tailor.find().sort({ status: 1, name: 1 }).lean(), tailorWorkloads()]);
  const items = tailors.map((tailor) => {
    const workload = workloads.get(String(tailor._id)) ?? { assignedOrders: 0, assignedUnits: 0 };
    return { ...tailor, workload };
  });
  res.json({ items, total: items.length });
});

router.post('/tailors', adminWriteLimiter, validate({ body: tailorSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof tailorSchema>>).validated.body;
  const tailor = await Tailor.create({ ...body });
  await logAction(req, 'CREATE_TAILOR', 'TAILOR', String(tailor._id), `Tailor created: ${tailor.name}`);
  res.status(201).json({ tailor });
});

router.patch('/tailors/:id', adminWriteLimiter, validate({ params: objectIdParamSchema, body: tailorSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const tailor = await Tailor.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!tailor) throw notFound('Tailor nahi mila.');
  await logAction(req, 'UPDATE_TAILOR', 'TAILOR', id, `Tailor updated: ${tailor.name}`);
  res.json({ tailor });
});

router.delete('/tailors/:id', adminWriteLimiter, validate({ params: objectIdParamSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const activeAssigned = await Order.countDocuments({
    'tailor.tailorId': id,
    status: { $in: ['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'] },
  });
  if (activeAssigned > 0) throw conflict('Tailor ke active orders hain — pehle reassign karke INACTIVE karein.');
  const tailor = await Tailor.findByIdAndUpdate(id, { $set: { status: 'INACTIVE' } }, { new: true });
  if (!tailor) throw notFound('Tailor nahi mila.');
  await logAction(req, 'DELETE_TAILOR', 'TAILOR', id, `Tailor deactivated: ${tailor.name}`);
  res.json({ ok: true, tailor });
});

router.get('/tailor-dashboard', adminReadLimiter, async (_req: Request, res: Response) => {
  const [tailors, workloads, pending, awaiting] = await Promise.all([
    Tailor.find().sort({ status: 1, name: 1 }).lean(),
    tailorWorkloads(),
    pendingWorkload(),
    awaitingTailorCount(),
  ]);
  const items = tailors.map((tailor) => {
    const workload = workloads.get(String(tailor._id)) ?? { assignedOrders: 0, assignedUnits: 0 };
    return { tailor, workload };
  });
  res.json({
    tailors: items,
    totalActiveTailors: items.filter((item) => item.tailor.status === 'ACTIVE').length,
    pendingWorkload: pending,
    awaitingTailorCount: awaiting,
  });
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

router.get('/shipping/shiprocket/status', adminReadLimiter, async (req: Request, res: Response) => {
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

router.patch('/shipping/shiprocket/settings', adminWriteLimiter, validate({ body: shiprocketSettingsSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<Partial<ShiprocketSettings>>).validated.body;
  const settings = await updateShiprocketSettings(body);
  await logAction(req, 'UPDATE', 'SHIPROCKET_SETTINGS', 'settings', 'Shiprocket settings updated');
  res.json({ settings });
});

router.post('/shipping/shiprocket/test-connection', adminWriteLimiter, async (req: Request, res: Response) => {
  const result = await testConnection();
  await logAction(req, 'TEST_CONNECTION', 'SHIPROCKET_SETTINGS', 'settings', `Shiprocket test: ${result.message}`);
  res.json(result);
});

router.post('/shipping/shiprocket/test-webhook', adminWriteLimiter, async (req: Request, res: Response) => {
  await recordWebhookReceipt('shiprocket');
  await logAction(req, 'TEST_WEBHOOK', 'SHIPROCKET_SETTINGS', 'settings', 'Shiprocket webhook test receipt recorded');
  res.json({ ok: true, message: 'Webhook receipt recorded (test). Shippedrocket panel "Webhook connected" update hoga.' });
});

/** Recommended courier list pre-filled by the admin AWB form. */
router.get('/orders/:orderNumber/shiprocket/recommend', adminReadLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
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

router.post('/orders/:orderNumber/shiprocket/create', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
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

router.post('/orders/:orderNumber/shiprocket/awb', adminWriteLimiter, validate({ params: orderNumberSchema, body: awbSchema }), async (req: Request, res: Response) => {
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

router.post('/orders/:orderNumber/shiprocket/pickup', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
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

router.post('/orders/:orderNumber/shiprocket/label', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
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

router.get('/orders/:orderNumber/shiprocket/tracking', adminReadLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  await doSyncOrderTracking(req, orderNumber, 'VIEW');
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ tracking: fresh?.shipping ?? {}, order: fresh });
});

router.post('/orders/:orderNumber/shiprocket/sync', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
  const { orderNumber } = (req as ValidatedRequest<unknown, unknown, { orderNumber: string }>).validated.params;
  await doSyncOrderTracking(req, orderNumber, 'SYNC');
  const fresh = await Order.findOne({ orderNumber }).lean();
  res.json({ tracking: fresh?.shipping ?? {}, order: fresh });
});

router.post('/orders/:orderNumber/shiprocket/cancel', adminWriteLimiter, validate({ params: orderNumberSchema }), async (req: Request, res: Response) => {
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

router.get('/products', adminReadLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.q) {
    const q = String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (q) filter.$or = [{ designId: new RegExp(q, 'i') }, { name: new RegExp(q, 'i') }, { slug: new RegExp(q, 'i') }];
  }
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.includeArchived !== 'true') filter.isActive = true;
  const items = await Product.find(filter).sort({ updatedAt: -1 }).limit(300).populate('category', 'name slug').populate('createdBy', 'name mobile').lean();
  res.json({ items });
});

router.post('/products', adminWriteLimiter, validate({ body: productSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof productSchema>>).validated.body;
  // Blank design ID / slug are fine — they are generated automatically.
  const designId = body.designId?.trim() ? body.designId.trim() : await nextDesignId();
  // Blank name falls back to the design code so products remain findable.
  const name = body.name?.trim() || designId;
  const slug = body.slug?.trim() ? body.slug.trim().toLowerCase() : await uniqueSlug(name);
  // Blank category falls back to the first category so a "price + image" save works.
  const category = body.category?.trim() || String((await Category.findOne({}).sort({ _id: 1 }).select('_id').lean())?._id ?? '');
  if (!category) throw badRequest('Pehle ek category bana lein (Catalog tab), phir product save karein.');
  // Blank MRP just mirrors the selling price (no fake discount shown).
  const mrpInr = body.mrpInr && body.mrpInr > 0 ? body.mrpInr : body.sellingPriceInr;

  // Ready-made products always keep a COMPLETE size × colour stock matrix:
  // fill empty SKUs with the conventional code and create any colour × size
  // combination the admin didn't send with default stock 10. This is the
  // same cross product the seed uses, guarded server-side so no API caller
  // can forget a combo.
  const colors = (body.colors ?? []) as Array<{ slug: string }>;
  const sizes = (body.sizes ?? []) as number[];
  const sentVariants = (body.variants ?? []) as Array<{ colorSlug?: string; size?: number; sku?: string }>;
  let variants: unknown[] = sentVariants;
  if (body.type === 'READY_MADE' || body.type === 'BOTH') {
    variants = sentVariants.map((v) =>
      (v.sku && String(v.sku).trim()) || !v.colorSlug
        ? v
        : { ...v, sku: `${designId}-${v.colorSlug.toUpperCase().slice(0, 3)}-${v.size}` },
    );
    if (colors.length > 0 && sizes.length > 0) {
      const known = new Set(variants.map((v) => `${String((v as { colorSlug?: string }).colorSlug)}|${(v as { size?: number }).size}`));
      const additions: Array<Record<string, unknown>> = [];
      for (const color of colors) {
        for (const size of sizes) {
          if (known.has(`${color.slug}|${size}`)) continue;
          additions.push({
            colorSlug: color.slug,
            size,
            stock: 10,
            sku: `${designId}-${color.slug.toUpperCase().slice(0, 3)}-${size}`,
          });
        }
      }
      if (additions.length > 0) variants = [...variants, ...additions];
    }
  }

  const product = await Product.create({ ...body, name, category, mrpInr, variants, designId, slug, createdBy: adminId(req) });
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

router.post('/products/generate-with-qwen', adminWriteLimiter, validate({ body: productQwenBodySchema }), async (req: Request, res: Response) => {
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

router.post('/fabrics/generate-with-qwen', adminWriteLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateFabricSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'FABRIC', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.post('/laces/generate-with-qwen', adminWriteLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateLaceSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'LACE', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.post('/latkans/generate-with-qwen', adminWriteLimiter, validate({ body: qwenBodySchema }), async (req: Request, res: Response) => {
  const { imageUrl } = (req as ValidatedRequest<{ imageUrl: string }>).validated.body;
  const suggestion = await generateLatkanSuggestion(imageUrl);
  await logAction(req, 'GENERATE_WITH_QWEN', 'LATKAN', 'preview', `Suggested from image for ${imageUrl.slice(0, 80)}`);
  res.json({ suggestion });
});

router.get('/products/:id', adminReadLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findById(id).populate('category', 'name slug').populate('subCategory', 'name slug').populate('createdBy', 'name mobile').lean();
  if (!product) throw notFound('Product nahi mila.');
  res.json({ product });
});

router.patch('/products/:id', adminWriteLimiter, validate({ params: idSchema, body: productPatchSchema }), async (req: Request, res: Response) => {
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

router.delete('/products/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!product) throw notFound('Product nahi mila.');
  await logAction(req, 'ARCHIVE', 'PRODUCT', id, product.designId);
  res.json({ ok: true });
});

router.post('/products/:id/duplicate', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const product = await Product.findById(id).lean();
  if (!product) throw notFound('Product nahi mila.');

  const { _id, createdAt, updatedAt, publishedAt, ...rest } = product;
  const designId = await nextDesignId();
  const slug = await uniqueSlug(product.name);

  const copy = await Product.create({
    ...rest,
    designId,
    slug,
    isActive: false,
    name: product.name,
    createdBy: adminId(req),
  });

  await logAction(req, 'DUPLICATE', 'PRODUCT', String(copy._id), copy.designId);
  res.status(201).json({ product: copy });
});

/* ========================================================================== */
/* Categories — 85.9                                                          */
/* ========================================================================== */

router.get('/categories', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Category.find().sort({ order: 1, name: 1 }).lean();
  const counts = await Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json({ items: items.map((c) => ({ ...c, productCount: countMap.get(String(c._id)) ?? 0 })) });
});

router.post('/categories', adminWriteLimiter, validate({ body: categorySchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof categorySchema>>).validated.body;
  const category = await Category.create(body);
  await logAction(req, 'CREATE', 'CATEGORY', String(category._id), category.name);
  res.status(201).json({ category });
});

router.patch('/categories/:id', adminWriteLimiter, validate({ params: idSchema, body: categorySchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const category = await Category.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!category) throw notFound('Category nahi mili.');
  await logAction(req, 'UPDATE', 'CATEGORY', id, category.name);
  res.json({ category });
});

router.delete('/categories/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/fabrics', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Fabric.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/fabrics', adminWriteLimiter, validate({ body: fabricSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof fabricSchema>>).validated.body;
  const fabric = await Fabric.create(body);
  await logAction(req, 'CREATE', 'FABRIC', String(fabric._id), fabric.name);
  res.status(201).json({ fabric });
});

router.patch('/fabrics/:id', adminWriteLimiter, validate({ params: idSchema, body: fabricSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const fabric = await Fabric.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!fabric) throw notFound('Fabric nahi mila.');
  await logAction(req, 'UPDATE', 'FABRIC', id, fabric.name);
  res.json({ fabric });
});

router.delete('/fabrics/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const fabric = await Fabric.findByIdAndDelete(id);
  if (!fabric) throw notFound('Fabric nahi mila.');
  await logAction(req, 'DELETE', 'FABRIC', id, fabric.name);
  res.json({ ok: true });
});

router.post('/fabrics/:id/duplicate', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/laces', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Lace.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/laces', adminWriteLimiter, validate({ body: laceSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof laceSchema>>).validated.body;
  const lace = await Lace.create(body);
  await logAction(req, 'CREATE', 'LACE', String(lace._id), lace.name);
  res.status(201).json({ lace });
});

router.patch('/laces/:id', adminWriteLimiter, validate({ params: idSchema, body: laceSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const lace = await Lace.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!lace) throw notFound('Lace nahi mila.');
  await logAction(req, 'UPDATE', 'LACE', id, lace.name);
  res.json({ lace });
});

router.delete('/laces/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const lace = await Lace.findByIdAndDelete(id);
  if (!lace) throw notFound('Lace nahi mila.');
  await logAction(req, 'DELETE', 'LACE', id, lace.name);
  res.json({ ok: true });
});

router.post('/laces/:id/duplicate', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/latkans', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Latkan.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/latkans', adminWriteLimiter, validate({ body: latkanSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof latkanSchema>>).validated.body;
  const latkan = await Latkan.create(body);
  await logAction(req, 'CREATE', 'LATKAN', String(latkan._id), latkan.name);
  res.status(201).json({ latkan });
});

router.patch('/latkans/:id', adminWriteLimiter, validate({ params: idSchema, body: latkanSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const latkan = await Latkan.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!latkan) throw notFound('Latkan nahi mila.');
  await logAction(req, 'UPDATE', 'LATKAN', id, latkan.name);
  res.json({ latkan });
});

router.delete('/latkans/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const latkan = await Latkan.findByIdAndDelete(id);
  if (!latkan) throw notFound('Latkan nahi mila.');
  await logAction(req, 'DELETE', 'LATKAN', id, latkan.name);
  res.json({ ok: true });
});

router.post('/latkans/:id/duplicate', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/colors', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Color.find().sort({ order: 1, name: 1 }).lean();
  res.json({ items });
});

router.post('/colors', adminWriteLimiter, validate({ body: colorSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof colorSchema>>).validated.body;
  const color = await Color.create(body);
  await logAction(req, 'CREATE', 'COLOR', String(color._id), color.name);
  res.status(201).json({ color });
});

router.patch('/colors/:id', adminWriteLimiter, validate({ params: idSchema, body: colorSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const color = await Color.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!color) throw notFound('Color nahi mila.');
  await logAction(req, 'UPDATE', 'COLOR', id, color.name);
  res.json({ color });
});

router.delete('/colors/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const color = await Color.findByIdAndDelete(id);
  if (!color) throw notFound('Color nahi mila.');
  await logAction(req, 'DELETE', 'COLOR', id, color.name);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Sizes — 85.7                                                               */
/* ========================================================================== */

router.get('/sizes', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Size.find().sort({ order: 1, value: 1 }).lean();
  res.json({ items });
});

router.post('/sizes', adminWriteLimiter, validate({ body: sizeSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof sizeSchema>>).validated.body;
  const size = await Size.create(body);
  await logAction(req, 'CREATE', 'SIZE', String(size._id), size.label);
  res.status(201).json({ size });
});

router.patch('/sizes/:id', adminWriteLimiter, validate({ params: idSchema, body: sizeSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const size = await Size.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!size) throw notFound('Size nahi mila.');
  await logAction(req, 'UPDATE', 'SIZE', id, size.label);
  res.json({ size });
});

router.delete('/sizes/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const size = await Size.findByIdAndDelete(id);
  if (!size) throw notFound('Size nahi mila.');
  await logAction(req, 'DELETE', 'SIZE', id, size.label);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Coupons — 85.15                                                            */
/* ========================================================================== */

router.get('/coupons', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/coupons', adminWriteLimiter, validate({ body: couponSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof couponSchema>>).validated.body;
  const coupon = await Coupon.create({ ...body, code: body.code.toUpperCase() });
  await logAction(req, 'CREATE', 'COUPON', String(coupon._id), coupon.code);
  res.status(201).json({ coupon });
});

router.patch('/coupons/:id', adminWriteLimiter, validate({ params: idSchema, body: couponSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const coupon = await Coupon.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!coupon) throw notFound('Coupon nahi mila.');
  await logAction(req, 'UPDATE', 'COUPON', id, coupon.code);
  res.json({ coupon });
});

router.delete('/coupons/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const coupon = await Coupon.findByIdAndDelete(id);
  if (!coupon) throw notFound('Coupon nahi mila.');
  await logAction(req, 'DELETE', 'COUPON', id, coupon.code);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Banners — 85.13                                                            */
/* ========================================================================== */

router.get('/banners', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Banner.find().sort({ order: 1, createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/banners', adminWriteLimiter, validate({ body: bannerSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof bannerSchema>>).validated.body;
  const banner = await Banner.create(body);
  await logAction(req, 'CREATE', 'BANNER', String(banner._id), banner.title);
  res.status(201).json({ banner });
});

router.patch('/banners/:id', adminWriteLimiter, validate({ params: idSchema, body: bannerSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const banner = await Banner.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!banner) throw notFound('Banner nahi mila.');
  await logAction(req, 'UPDATE', 'BANNER', id, banner.title);
  res.json({ banner });
});

router.delete('/banners/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const banner = await Banner.findByIdAndDelete(id);
  if (!banner) throw notFound('Banner nahi mila.');
  await logAction(req, 'DELETE', 'BANNER', id, banner.title);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Offer popups — 85.14                                                       */
/* ========================================================================== */

router.get('/offer-popups', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await OfferPopup.find()
    .sort({ order: 1, createdAt: -1 })
    .populate('productId', 'designId name slug images sellingPriceInr mrpInr type')
    .lean();
  res.json({ items });
});

router.post('/offer-popups', adminWriteLimiter, validate({ body: offerPopupSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof offerPopupSchema>>).validated.body;
  const popup = await OfferPopup.create(body);
  await logAction(req, 'CREATE', 'OFFER_POPUP', String(popup._id), popup.offerType);
  res.status(201).json({ popup });
});

router.patch('/offer-popups/:id', adminWriteLimiter, validate({ params: idSchema, body: offerPopupSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const popup = await OfferPopup.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!popup) throw notFound('Offer popup nahi mila.');
  await logAction(req, 'UPDATE', 'OFFER_POPUP', id, popup.offerType);
  res.json({ popup });
});

router.delete('/offer-popups/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const popup = await OfferPopup.findByIdAndDelete(id);
  if (!popup) throw notFound('Offer popup nahi mila.');
  await logAction(req, 'DELETE', 'OFFER_POPUP', id, String(popup.offerType));
  res.json({ ok: true });
});

/* ========================================================================== */
/* Pages / Content — 85.12                                                    */
/* ========================================================================== */

router.get('/pages', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await Page.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/pages', adminWriteLimiter, validate({ body: pageSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof pageSchema>>).validated.body;
  const page = await Page.create(body);
  await logAction(req, 'CREATE', 'PAGE', String(page._id), page.slug);
  res.status(201).json({ page });
});

router.patch('/pages/:id', adminWriteLimiter, validate({ params: idSchema, body: pageSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const page = await Page.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!page) throw notFound('Page nahi mila.');
  await logAction(req, 'UPDATE', 'PAGE', id, page.slug);
  res.json({ page });
});

router.delete('/pages/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/homepage-sections', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await HomepageSection.find().sort({ order: 1 }).lean();
  res.json({ items: sortHomeSections(items) });
});

router.post('/homepage-sections', adminWriteLimiter, validate({ body: homepageSectionSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof homepageSectionSchema>>).validated.body;
  const section = await HomepageSection.create(body);
  await logAction(req, 'CREATE', 'HOME_SECTION', String(section._id), section.title);
  res.status(201).json({ section });
});

router.patch('/homepage-sections/:id', adminWriteLimiter, validate({ params: idSchema, body: homepageSectionSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const section = await HomepageSection.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!section) throw notFound('Section nahi mila.');
  await logAction(req, 'UPDATE', 'HOME_SECTION', id, section.title);
  res.json({ section });
});

router.delete('/homepage-sections/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const section = await HomepageSection.findByIdAndDelete(id);
  if (!section) throw notFound('Section nahi mila.');
  await logAction(req, 'DELETE', 'HOME_SECTION', id, section.title);
  res.json({ ok: true });
});

/* ========================================================================== */
/* Customers — 85.28                                                          */
/* ========================================================================== */

router.get('/customers', adminReadLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.q) {
    const q = String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

router.get('/customers/:id', adminReadLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const user = await User.findById(id).select('-refreshTokens').lean();
  if (!user) throw notFound('Customer nahi mila.');
  const [orders, wishlistCount] = await Promise.all([
    Order.find({ user: id }).sort({ placedAt: -1 }).limit(100).lean(),
    (await import('../models/commerce.js')).Wishlist.findOne({ user: id }).select('products').lean(),
  ]);
  res.json({ user, orders, wishlistCount: wishlistCount?.products?.length ?? 0 });
});

router.patch('/customers/:id', adminWriteLimiter, validate({
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

router.get('/reviews', adminReadLimiter, async (req: Request, res: Response) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status)) ? String(req.query.status) : undefined;
  res.json({ items: await Review.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).populate('product', 'designId name').lean() });
});
router.patch('/reviews/:id/status', adminWriteLimiter, validate({ params: idSchema, body: reviewStatusSchema }), async (req: Request, res: Response) => {
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

router.get('/measurements', adminReadLimiter, async (_req: Request, res: Response) => res.json({ items: await MeasurementField.find().sort({ order: 1 }).lean() }));
router.post('/measurements', adminWriteLimiter, validate({ body: measurementSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof measurementSchema>>).validated.body;
  const field = await MeasurementField.create(body);
  await logAction(req, 'CREATE', 'MEASUREMENT_FIELD', String(field._id), field.key);
  res.status(201).json({ field });
});
router.patch('/measurements/:id', adminWriteLimiter, validate({ params: idSchema, body: measurementSchema.partial() }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const field = await MeasurementField.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!field) throw notFound('Measurement field nahi mila.');
  await logAction(req, 'UPDATE', 'MEASUREMENT_FIELD', id, String(field.key));
  res.json({ field });
});
router.delete('/measurements/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const field = await MeasurementField.findByIdAndDelete(id);
  if (!field) throw notFound('Measurement field nahi mila.');
  await logAction(req, 'DELETE', 'MEASUREMENT_FIELD', id, String(field.key));
  res.json({ ok: true });
});

/* ========================================================================== */
/* Enquiries — WhatsApp & contact (85.30)                                     */
/* ========================================================================== */

router.get('/enquiries', adminReadLimiter, async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.channel) filter.channel = String(req.query.channel);
  const items = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate('product', 'designId name')
    .populate('user', 'name mobile email avatarUrl')
    .lean();
  res.json({ items });
});

router.delete('/enquiries/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const enquiry = await Enquiry.findByIdAndDelete(id);
  if (!enquiry) throw notFound('Enquiry nahi mili.');
  await logAction(req, 'DELETE', 'ENQUIRY', id, '');
  res.json({ ok: true });
});

/* ========================================================================== */
/* Analytics — 85.2 deep drill / module 29                                    */
/* ========================================================================== */

router.get('/analytics/overview', adminReadLimiter, async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const range = { $gte: from, $lte: to };
  const [eventBreakdown, topPages, topSearches, sourceBreakdown, deviceBreakdown, uniqueSessions, checkoutRows] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.aggregate([{ $match: { at: range, type: 'PAGE_VIEW', path: { $ne: '' } } }, { $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    AnalyticsEvent.aggregate([{ $match: { at: range, type: 'SEARCH', query: { $ne: '' } } }, { $group: { _id: '$query', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.aggregate([{ $match: { at: range } }, { $group: { _id: '$device.type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AnalyticsEvent.distinct('sessionId', { at: range }),
    AnalyticsEvent.aggregate([
      { $match: { at: range, type: { $in: ['CHECKOUT_START', 'CHECKOUT_BACK', 'CHECKOUT_CANCEL', 'CHECKOUT_ABANDON', 'ORDER_PLACED'] } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);
  const checkoutSummary = {
    started: checkoutRows.find((row) => row._id === 'CHECKOUT_START')?.count ?? 0,
    backedOut: checkoutRows.find((row) => row._id === 'CHECKOUT_BACK')?.count ?? 0,
    cancelled: checkoutRows.find((row) => row._id === 'CHECKOUT_CANCEL')?.count ?? 0,
    abandoned: checkoutRows.find((row) => row._id === 'CHECKOUT_ABANDON')?.count ?? 0,
    completed: checkoutRows.find((row) => row._id === 'ORDER_PLACED')?.count ?? 0,
  };
  res.json({ from, to, eventBreakdown, topPages, topSearches, sourceBreakdown, deviceBreakdown, uniqueSessions: uniqueSessions.length, checkoutSummary });
});

router.get('/analytics/products', adminReadLimiter, async (req: Request, res: Response) => {
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
/* Dashboard drill-downs — real records behind the Overview KPI cards          */
/* ========================================================================== */

function dashboardRange(req: Request): { from: Date; to: Date; range: { $gte: Date; $lte: Date } } {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  return { from, to, range: { $gte: from, $lte: to } };
}

interface DrillOrderRow {
  orderNumber: string;
  status?: string;
  placedAt?: Date | string;
  totalMinor?: number;
  paymentStatus?: string;
  mobile?: string;
  name?: string;
}

/** Orders that contain any of the given product ids — used to flag conversions. */
async function productConversionOrders(productIds: string[]): Promise<Map<string, DrillOrderRow[]>> {
  const map = new Map<string, DrillOrderRow[]>();
  if (productIds.length === 0) return map;
  const docs = await Order.find({ 'items.product': { $in: productIds } })
    .select('orderNumber status placedAt amounts.totalMinor payment.status contact.mobile contact.name items.product')
    .sort({ placedAt: -1 })
    .limit(2000)
    .lean();
  for (const doc of docs) {
    const row: DrillOrderRow = {
      orderNumber: (doc as { orderNumber: string }).orderNumber,
      status: (doc as { status?: string }).status,
      placedAt: (doc as { placedAt?: Date }).placedAt,
      totalMinor: (doc as { amounts?: { totalMinor?: number } }).amounts?.totalMinor ?? 0,
      paymentStatus: (doc as { payment?: { status?: string } }).payment?.status ?? '',
      mobile: (doc as { contact?: { mobile?: string } }).contact?.mobile ?? '',
      name: (doc as { contact?: { name?: string } }).contact?.name ?? '',
    };
    const items = (doc as { items?: Array<{ product?: unknown }> }).items ?? [];
    for (const item of items) {
      const key = String(item.product);
      const bucket = map.get(key) ?? [];
      if (bucket.length < 3) bucket.push(row);
      map.set(key, bucket);
    }
  }
  return map;
}

/** Attaches product + customer + conversion facts to CART_ADD / WISHLIST_ADD events. */
async function attachmentEvents(eventType: 'CART_ADD' | 'WISHLIST_ADD', range: { $gte: Date; $lte: Date }): Promise<Record<string, unknown>[]> {
  const events = await AnalyticsEvent.find({ type: eventType, at: range })
    .sort({ at: -1 })
    .limit(200)
    .lean();
  const productIds = [...new Set(events.map((e) => (e.product ? String(e.product) : '')).filter(Boolean))];
  const userIds = [...new Set(events.map((e) => (e.user ? String(e.user) : '')).filter(Boolean))];

  const [products, users, removes, conversions] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).select('designId name slug sellingPriceInr images variants').lean(),
    User.find({ _id: { $in: userIds } }).select('name mobile email avatarUrl').lean(),
    AnalyticsEvent.find({ type: eventType === 'CART_ADD' ? 'CART_REMOVE' : 'WISHLIST_REMOVE', product: { $in: productIds } })
      .select('product sessionId at')
      .lean(),
    productConversionOrders(productIds),
  ]);

  const productById = new Map(products.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const removalKeys = new Set(removes.map((r) => `${String(r.product)}|${r.sessionId}`));

  const items = events.map((ev) => {
    const product = productById.get(String(ev.product));
    const user = ev.user ? userById.get(String(ev.user)) : undefined;
    const quantity = Math.max(1, Math.round((ev.value ?? 0)) || 1);
    const priceMinor = product ? Number((product as { sellingPriceInr?: number }).sellingPriceInr ?? 0) * 100 : 0;
    const userMobile = (user as { mobile?: string } | undefined)?.mobile ?? '';
    const matches = (conversions.get(String(ev.product)) ?? []).filter((row) => {
      const placed = new Date(row.placedAt ?? 0);
      return placed.getTime() >= new Date(ev.at ?? 0).getTime() && (!userMobile || row.mobile === userMobile);
    });
    const converted = matches[0] ?? null;
    const removed = removalKeys.has(`${String(ev.product)}|${ev.sessionId}`);
    return {
      _id: String(ev._id),
      at: ev.at,
      product: product
        ? {
            _id: String(product._id),
            designId: (product as { designId: string }).designId,
            name: (product as { name: string }).name,
            image: (product as { images?: Array<{ url?: string }> }).images?.[0]?.url ?? '',
            sku: (product as { variants?: Array<{ sku?: string }> }).variants?.[0]?.sku ?? '',
            priceMinor,
          }
        : null,
      customer: user ? { _id: String(user._id), name: (user as { name?: string }).name, mobile: userMobile, email: (user as { email?: string }).email } : null,
      quantity,
      cartValueMinor: quantity * priceMinor,
      inCart: !removed && !converted,
      converted: converted
        ? {
            orderNumber: converted.orderNumber,
            status: converted.status ?? '',
            totalMinor: converted.totalMinor ?? 0,
            paymentStatus: converted.paymentStatus ?? '',
            placedAt: converted.placedAt,
          }
        : null,
    };
  });

  return items as Record<string, unknown>[];
}

router.get('/dashboard/cart-adds', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);
  const items = await attachmentEvents('CART_ADD', range);
  res.json({ items });
});

router.get('/dashboard/wishlist-adds', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);
  const items = await attachmentEvents('WISHLIST_ADD', range);
  // Wishlist rows also expose the current stock and whether the design uses orders.
  const itemsWithStock = await Promise.all(
    (items as Array<{ product?: { _id?: string } | null }>).map(async (item) => {
      const productId = item.product?._id;
      if (!productId) return item;
      const doc = await Product.findById(productId).select('variants').lean();
      const stock = (doc?.variants ?? []).reduce((sum, v) => sum + Number((v as { stock?: number }).stock ?? 0), 0);
      return { ...item, currentStock: stock };
    }),
  );
  res.json({ items: itemsWithStock });
});

router.get('/dashboard/revenue', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);
  const paidStatuses = ['PAID', 'COD_PENDING'];
  const pendingStatuses = ['PENDING', 'COD_ADVANCE_PENDING', 'COD_ADVANCE_PAID'];

  const [revenue, pending, refunded, recent] = await Promise.all([
    Order.aggregate([
      { $match: { placedAt: range, 'payment.status': { $in: paidStatuses } } },
      { $group: { _id: null, totalMinor: { $sum: '$amounts.totalMinor' }, count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { placedAt: range, 'payment.status': { $in: pendingStatuses } } },
      { $group: { _id: null, totalMinor: { $sum: '$amounts.totalMinor' }, count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { placedAt: range, 'cancellation.refund.status': 'COMPLETED' } },
      { $group: { _id: null, totalMinor: { $sum: '$cancellation.refund.amountMinor' } } },
    ]),
    Order.find({ placedAt: range, 'payment.status': { $in: paidStatuses } })
      .sort({ placedAt: -1 })
      .limit(8)
      .select('orderNumber placedAt amounts payment.status contact.name contact.mobile items')
      .lean(),
  ]);

  const totalMinor = revenue[0]?.totalMinor ?? 0;
  const paidOrders = revenue[0]?.count ?? 0;

  res.json({
    totalMinor,
    paidOrders,
    averageMinor: paidOrders > 0 ? Math.round(totalMinor / paidOrders) : 0,
    pendingMinor: pending[0]?.totalMinor ?? 0,
    pendingOrders: pending[0]?.count ?? 0,
    refundedMinor: refunded[0]?.totalMinor ?? 0,
    recent: recent.map((doc) => {
      const order = doc as unknown as {
        orderNumber: string; placedAt?: Date; amounts?: { totalMinor?: number };
        payment?: { status?: string }; contact?: { name?: string; mobile?: string }; items?: Array<{ name?: string; designId?: string; image?: string }>;
      };
      return {
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        totalMinor: order.amounts?.totalMinor ?? 0,
        paymentStatus: order.payment?.status ?? '',
        customer: order.contact?.name ?? '',
        mobile: order.contact?.mobile ?? '',
        item: order.items?.[0] ? { name: order.items[0].name ?? '', designId: order.items[0].designId ?? '', image: order.items[0].image ?? '' } : null,
      };
    }),
  });
});

router.get('/dashboard/customers', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);

  const users = await User.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .select('name mobile email avatarUrl isBlocked createdAt lastLoginAt')
    .lean();

  const mobiles = [...new Set(users.map((u) => (u as { mobile?: string }).mobile ?? '').filter(Boolean))];
  const userIds = users.map((u) => String(u._id));

  const [orderRows, cartRows, wishlistRows] = await Promise.all([
    Order.aggregate([
      { $match: { 'contact.mobile': { $in: mobiles } } },
      { $group: { _id: '$contact.mobile', orderCount: { $sum: 1 }, totalMinor: { $sum: '$amounts.totalMinor' }, lastOrderAt: { $max: '$placedAt' } } },
    ]),
    AnalyticsEvent.aggregate([
      { $match: { type: 'CART_ADD', at: range, user: { $in: userIds } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    AnalyticsEvent.aggregate([
      { $match: { type: 'WISHLIST_ADD', at: range, user: { $in: userIds } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
  ]);

  const orderByMobile = new Map(orderRows.map((r) => [String((r as { _id: string })._id), r]));
  const cartByUser = new Map(cartRows.map((r) => [String((r as { _id: unknown })._id), (r as { count: number }).count]));
  const wishlistByUser = new Map(wishlistRows.map((r) => [String((r as { _id: unknown })._id), (r as { count: number }).count]));

  res.json({
    items: users.map((raw) => {
      const user = raw as { _id: unknown; name?: string; mobile?: string; email?: string; avatarUrl?: string; isBlocked?: boolean; createdAt?: Date; lastLoginAt?: Date | null };
      const orders = orderByMobile.get(user.mobile ?? '') ?? { orderCount: 0, totalMinor: 0, lastOrderAt: null };
      return {
        _id: String(user._id),
        name: user.name ?? '',
        mobile: user.mobile ?? '',
        email: user.email ?? '',
        avatarUrl: user.avatarUrl ?? '',
        isBlocked: Boolean(user.isBlocked),
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt ?? null,
        orderCount: orders.orderCount ?? 0,
        totalSpentMinor: orders.totalMinor ?? 0,
        lastOrderAt: orders.lastOrderAt ?? null,
        cartAdds: cartByUser.get(String(user._id)) ?? 0,
        wishlistAdds: wishlistByUser.get(String(user._id)) ?? 0,
      };
    }),
  });
});

router.get('/dashboard/products', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);

  const [products, eventCounts] = await Promise.all([
    Product.find()
      .sort({ isActive: -1, 'stats.views': -1 })
      .limit(200)
      .select('designId name slug type sellingPriceInr mrpInr images variants isActive stats')
      .lean(),
    AnalyticsEvent.aggregate([
      { $match: { at: range, type: { $in: ['PRODUCT_VIEW', 'CART_ADD', 'WISHLIST_ADD'] }, product: { $ne: null } } },
      { $group: { _id: { product: '$product', type: '$type' }, count: { $sum: 1 } } },
    ]),
  ]);

  const perProduct: Record<string, Record<string, number>> = {};
  for (const row of eventCounts) {
    const productId = String((row._id as { product: unknown }).product);
    (perProduct[productId] ??= {})[(row._id as { type: string }).type] = (row as { count: number }).count;
  }

  res.json({
    items: products.map((raw) => {
      const p = raw as { _id: unknown; designId: string; name: string; type: string; sellingPriceInr: number; mrpInr: number; isActive?: boolean; images?: Array<{ url?: string }>; variants?: Array<{ sku?: string; stock?: number }>; stats?: Record<string, number> };
      const views = Number(p.stats?.views ?? 0);
      const orders = Number(p.stats?.orders ?? 0);
      return {
        _id: String(p._id),
        designId: p.designId,
        name: p.name,
        type: p.type,
        image: p.images?.[0]?.url ?? '',
        sku: p.variants?.[0]?.sku ?? '',
        priceMinor: Number(p.sellingPriceInr ?? 0) * 100,
        mrpMinor: Number(p.mrpInr ?? 0) * 100,
        stock: p.type === 'READY_MADE' || p.type === 'BOTH' ? (p.variants ?? []).reduce((sum, v) => sum + Number(v.stock ?? 0), 0) : null,
        isActive: Boolean(p.isActive),
        allTimeOrders: orders,
        views,
        cartAdds: perProduct[String(p._id)]?.CART_ADD ?? 0,
        wishlistAdds: perProduct[String(p._id)]?.WISHLIST_ADD ?? 0,
        conversionRatePercent: views > 0 ? Math.round((orders / views) * 1000) / 10 : 0,
      };
    }),
  });
});

router.get('/dashboard/failed-payments', adminReadLimiter, async (req: Request, res: Response) => {
  const { range } = dashboardRange(req);
  const docs = await Order.find({ placedAt: range, 'payment.status': 'FAILED' })
    .sort({ placedAt: -1 })
    .limit(100)
    .select('orderNumber placedAt amounts payment contact')
    .lean();
  res.json({
    items: docs.map((raw) => {
      const doc = raw as unknown as {
        orderNumber: string; placedAt?: Date; amounts?: { totalMinor?: number };
        payment?: { razorpayPaymentId?: string; razorpayOrderId?: string; method?: string; status?: string; failureReason?: string };
        contact?: { name?: string; mobile?: string };
      };
      return {
        orderNumber: doc.orderNumber,
        placedAt: doc.placedAt,
        totalMinor: doc.amounts?.totalMinor ?? 0,
        paymentId: doc.payment?.razorpayPaymentId ?? doc.payment?.razorpayOrderId ?? '',
        method: doc.payment?.method ?? '',
        status: doc.payment?.status ?? '',
        failureReason: doc.payment?.failureReason ?? '',
        customer: doc.contact?.name ?? '',
        mobile: doc.contact?.mobile ?? '',
      };
    }),
  });
});

/* ========================================================================== */
/* Admin users & roles — 85.1 / module 31                                     */
/* ========================================================================== */

router.get('/admin-users', adminReadLimiter, async (_req: Request, res: Response) => {
  const items = await User.find({ adminRoles: { $exists: true, $ne: [] } }).select('name mobile email adminRoles isBlocked lastLoginAt createdAt').lean();
  res.json({ items });
});

router.post('/admin-users', adminWriteLimiter, validate({ body: userAdminSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof userAdminSchema>>).validated.body;
  const me = await User.findById(adminId(req)).lean();
  if (!me?.adminRoles?.includes('SUPER_ADMIN')) throw forbidden('Sirf Super Admin staff add kar sakta hai.');

  // Both identities are looked up together. Two hits means the mobile and the
  // email belong to different people — promoting either would be a guess, so we
  // stop instead of silently merging two accounts.
  const identity = [
    ...(body.mobile ? [{ mobile: body.mobile }] : []),
    ...(body.email ? [{ email: body.email }] : []),
  ];
  const matches = await User.find({ $or: identity }).limit(2);
  if (matches.length > 1) {
    throw conflict('Yeh mobile aur email do alag accounts ke hain. Ek hi identity se add karein.');
  }

  let user = matches[0];
  if (user) {
    // An existing account keeps the identity it already logs in with; only a
    // missing one is filled in. Overwriting would hand the account to someone else.
    if (body.mobile && !user.mobile) { user.mobile = body.mobile; user.mobileVerified = true; }
    if (body.email && !user.email) user.email = body.email;
    if (body.name && !user.name) user.name = body.name;
  } else {
    // emailVerified stays false — only a real Google sign-in proves the address.
    user = new User({
      ...(body.mobile ? { mobile: body.mobile, mobileVerified: true } : {}),
      ...(body.email ? { email: body.email } : {}),
      name: body.name,
    });
  }
  user.adminRoles = body.roles as AdminRole[];
  await user.save();
  await logAction(req, 'ASSIGN_ROLES', 'ADMIN_USER', String(user._id), `${body.mobile ?? body.email}: ${body.roles.join(', ')}`);
  res.status(201).json({ user });
});

router.patch('/admin-users/:id', adminWriteLimiter, validate({
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

router.delete('/admin-users/:id', adminWriteLimiter, validate({ params: idSchema }), async (req: Request, res: Response) => {
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

router.get('/settings', adminReadLimiter, async (_req: Request, res: Response) => {
  // Never echo credential-looking values back to the UI, even to admins.
  const secretKey = /(secret|password|api[-_]?key|razorpay|_token$|app[-_]?secret)/i;
  const items = await Setting.find().sort({ key: 1 }).lean();
  res.json({ items: items.filter((doc) => !secretKey.test(String(doc.key))) });
});
router.put('/settings/:key', adminWriteLimiter, validate({ body: settingSchema }), async (req: Request, res: Response) => {
  const key = String(req.params.key).trim().slice(0, 60);
  const setting = await Setting.findOneAndUpdate({ key }, { $set: { value: (req as ValidatedRequest<{ value: unknown }>).validated.body.value, updatedBy: adminId(req) } }, { upsert: true, new: true });
  invalidateSettingsCache();
  await logAction(req, 'UPDATE', 'SETTING', key, key);
  res.json({ setting });
});

/* ========================================================================== */
/* Activity log — 85.34                                                       */
/* ========================================================================== */

router.get('/activity', adminReadLimiter, async (_req: Request, res: Response) => res.json({ items: await AdminActivityLog.find().sort({ at: -1 }).limit(200).lean() }));

/* ========================================================================== */
/* Backups & export — 85.35–85.36                                             */
/* ========================================================================== */

router.get('/export/products', adminReadLimiter, async (_req: Request, res: Response) => res.json({ items: await Product.find().lean() }));
router.get('/export/orders', adminReadLimiter, async (_req: Request, res: Response) => res.json({ items: await Order.find().sort({ placedAt: -1 }).limit(500).lean() }));
router.get('/export/customers', adminReadLimiter, async (_req: Request, res: Response) => res.json({ items: await User.find().select('-refreshTokens').lean() }));
router.get('/export/inventory', adminReadLimiter, async (_req: Request, res: Response) => {
  const [fabrics, laces, latkans, products] = await Promise.all([
    Fabric.find().select('name material colorName stockMeters inStock slug').lean(),
    Lace.find().select('name colorName inStock slug priceInr').lean(),
    Latkan.find().select('name colorName inStock slug priceInr').lean(),
    Product.find({ type: 'READY_MADE' }).select('designId name variants colors sizes').lean(),
  ]);
  res.json({ items: { fabrics, laces, latkans, products } });
});

/* ========================================================================== */
/* WhatsApp Communications — 85.4 · MSG91 replaced by Meta Cloud API            */
/* ========================================================================== */

const whatsappSegmentSchema = z
  .object({
    hasOrders: z.boolean().default(false),
    minSpendMinor: z.number().int().min(0).max(10_000_000).default(0),
    purchasedProductIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product id')).max(50).default([]),
  })
  .default({});

const whatsappCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(1000),
    templateName: z.string().trim().min(1).max(40).default('guddi_offer'),
    language: z.string().trim().min(1).max(8).default('en_US'),
    targetSource: z.enum(['WEBSITE_USERS', 'ORDER_USERS', 'MANUAL_NUMBERS']).default('WEBSITE_USERS'),
    manualNumbers: z
      .array(z.string().trim().min(1).max(20))
      .max(500)
      .default([]),
    segment: whatsappSegmentSchema,
    perMessageCostInr: z.number().min(0).max(100).default(0.9),
  })
  .strict();
const whatsappCampaignPatchSchema = whatsappCampaignSchema.partial().strict();
const whatsappCampaignSendSchema = z.object({ confirm: z.boolean() }).strict();

const whatsappSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    notifyConfirmed: z.boolean().optional(),
    notifyShipped: z.boolean().optional(),
    notifyOutForDelivery: z.boolean().optional(),
    notifyDelivered: z.boolean().optional(),
    notifyCancelled: z.boolean().optional(),
    marketingCooldownDays: z.number().int().min(1).max(90).optional(),
    costPerMessageInr: z.number().min(0).max(100).optional(),
    dailyQuota: z.number().int().min(1).max(100_000).optional(),
    addOrderLink: z.boolean().optional(),
  })
  .strict();

const whatsappTestSchema = z.object({ mobile: z.string().trim().max(20).optional() }).strict();

router.get('/communications/overview', adminReadLimiter, async (_req: Request, res: Response) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [createdToday, sentToday, deliveredToday, failedToday, pending, deliveredAll, activeCampaigns, webhookLastAt, settings] = await Promise.all([
    MessageLog.countDocuments({ createdAt: { $gte: dayStart } }),
    MessageLog.countDocuments({ status: 'SENT', sentAt: { $gte: dayStart } }),
    MessageLog.countDocuments({ status: 'DELIVERED', deliveredAt: { $gte: dayStart } }),
    MessageLog.countDocuments({ status: 'FAILED', updatedAt: { $gte: dayStart } }),
    MessageLog.countDocuments({ status: 'PENDING' }),
    MessageLog.countDocuments({ status: { $in: ['DELIVERED', 'READ'] } }),
    WaCampaign.countDocuments({ status: { $in: ['QUEUED', 'SENDING'] } }),
    Setting.findOne({ key: 'whatsappWebhookLastAt' }).select('value').lean(),
    getWhatsAppSettings(),
  ]);
  res.json({
    integration: {
      configured: integrations.whatsapp,
      mode: whatsapp.mode,
      phoneNumberId: whatsapp.phoneNumberId || null,
      businessAccountId: whatsapp.businessAccountId || null,
      verifyTokenSet: Boolean(whatsapp.verifyToken),
      appSecretSet: Boolean(whatsapp.appSecret),
      testNumbers: [...new Set([env.ADMIN_MOBILE, ...whatsapp.testNumbers])].filter(Boolean),
    },
    webhookUrl: `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/whatsapp/webhook`,
    counts: { createdToday, sentToday, deliveredToday, failedToday, pending, delivered: deliveredAll, activeCampaigns },
    webhookLastAt: webhookLastAt?.value ? String(webhookLastAt.value) : null,
    settings,
  });
});

router.get('/communications/messages', adminReadLimiter, async (req: Request, res: Response) => {
  const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  const pageSize = 25;
  const status = String(req.query.status ?? '').toUpperCase();
  const type = String(req.query.type ?? '').toUpperCase();
  const filter: Record<string, unknown> = {};
  if ((['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] as readonly string[]).includes(status)) filter.status = status;
  if ((MESSAGE_TYPES as readonly string[]).includes(type)) filter.type = type;
  const [items, total] = await Promise.all([
    MessageLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    MessageLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, pageSize, hasMore: page * pageSize < total });
});

router.get('/communications/templates', adminReadLimiter, async (_req: Request, res: Response) => {
  res.json({
    templates: TEMPLATE_REGISTRY,
    webhookUrl: `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/whatsapp/webhook`,
    mode: whatsapp.mode,
    configured: integrations.whatsapp,
  });
});

router.post('/communications/test', adminWriteLimiter, validate({ body: whatsappTestSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<{ mobile?: string }>).validated.body;
  const candidates = [body.mobile?.replace(/[^\d]/g, ''), env.ADMIN_MOBILE, ...whatsapp.testNumbers];
  const mobile = candidates.find((m) => Boolean(m) && /^\d{10,15}$/.test(m as string));
  if (!mobile) throw badRequest('WhatsApp test number configure karein (WHATSAPP_TEST_NUMBERS ya ADMIN_MOBILE).');
  const result = await enqueueWhatsApp({
    mobile,
    templateName: 'guddi_offer',
    category: 'MARKETING',
    type: 'TEST',
    dedupeKey: `test:${mobile}:${Date.now()}`,
    components: buildComponents([`Yeh Guddi Silai ka TEST message hai — sab set! (${new Date().toLocaleString('en-IN')})`]),
  });
  if (!result.queued) throw badRequest(`Test message queue nahi hua: ${result.reason ?? 'unknown'}`);
  await logAction(req, 'WA_TEST', 'COMMUNICATIONS', mobile, 'Test WhatsApp bheja');
  res.json({ ok: true, messageLogId: result.messageLogId });
});

router.get('/communications/settings', adminReadLimiter, async (_req: Request, res: Response) => {
  res.json({ settings: await getWhatsAppSettings() });
});

router.put('/communications/settings', adminWriteLimiter, validate({ body: whatsappSettingsPatchSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<Record<string, unknown>>).validated.body;
  const settings = await updateWhatsAppSettings(body);
  await logAction(req, 'UPDATE', 'COMMUNICATIONS_SETTINGS', 'whatsapp', JSON.stringify(body));
  res.json({ settings });
});

router.get('/communications/campaigns', adminReadLimiter, async (_req: Request, res: Response) => {
  res.json({ items: await WaCampaign.find().sort({ createdAt: -1 }).limit(100).lean() });
});

router.post('/communications/campaigns', adminWriteLimiter, validate({ body: whatsappCampaignSchema }), async (req: Request, res: Response) => {
  const body = (req as ValidatedRequest<z.infer<typeof whatsappCampaignSchema>>).validated.body;
  const campaign = await WaCampaign.create({ ...body, createdBy: new Types.ObjectId(adminId(req)), status: 'DRAFT' });
  await logAction(req, 'CREATE', 'CAMPAIGN', String(campaign._id), campaign.name);
  res.json({ campaign });
});

router.get('/communications/campaigns/:id', adminReadLimiter, validate({ params: objectIdParamSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const campaign = await WaCampaign.findById(id);
  if (!campaign) throw notFound('Campaign nahi mila.');
  res.json({ campaign });
});

router.patch('/communications/campaigns/:id', adminWriteLimiter, validate({ params: objectIdParamSchema, body: whatsappCampaignPatchSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<Record<string, unknown>, unknown, { id: string }>).validated.params;
  const body = (req as ValidatedRequest<Record<string, unknown>, unknown, { id: string }>).validated.body;
  const campaign = await WaCampaign.findById(id);
  if (!campaign) throw notFound('Campaign nahi mila.');
  if (campaign.status !== 'DRAFT') throw badRequest('Sirf DRAFT campaign edit hota hai — send hone ke baad locked.');
  Object.assign(campaign, body);
  await campaign.save();
  await logAction(req, 'UPDATE', 'CAMPAIGN', id, campaign.name);
  res.json({ campaign });
});

router.delete('/communications/campaigns/:id', adminWriteLimiter, validate({ params: objectIdParamSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const campaign = await WaCampaign.findById(id);
  if (!campaign) throw notFound('Campaign nahi mila.');
  if (campaign.status !== 'DRAFT') throw badRequest('Sirf DRAFT campaign delete hota hai.');
  await WaCampaign.deleteOne({ _id: id });
  await logAction(req, 'DELETE', 'CAMPAIGN', id, campaign.name);
  res.json({ ok: true });
});

router.post('/communications/campaigns/:id/preview', adminWriteLimiter, validate({ params: objectIdParamSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<unknown, unknown, { id: string }>).validated.params;
  const campaign = await WaCampaign.findById(id);
  if (!campaign) throw notFound('Campaign nahi mila.');
  const recipients = await targetsForCampaign(campaign);
  const settings = await getWhatsAppSettings();
  res.json({
    recipientCount: recipients.length,
    estimatedCostInr: Math.round(recipients.length * campaign.perMessageCostInr * 100) / 100,
    cooldownDays: settings.marketingCooldownDays,
  });
});

router.post('/communications/campaigns/:id/send', adminWriteLimiter, validate({ params: objectIdParamSchema, body: whatsappCampaignSendSchema }), async (req: Request, res: Response) => {
  const { id } = (req as ValidatedRequest<{ confirm: boolean }, unknown, { id: string }>).validated.params;
  const { confirm } = (req as ValidatedRequest<{ confirm: boolean }, unknown, { id: string }>).validated.body;
  const campaign = await WaCampaign.findById(id);
  if (!campaign) throw notFound('Campaign nahi mila.');
  const result = await sendCampaign(campaign, confirm);
  await logAction(req, 'SEND', 'CAMPAIGN', id, `${campaign.name} → ${result.queued} recipients`);
  res.json({ ...result, status: campaign.status });
});

export default router;