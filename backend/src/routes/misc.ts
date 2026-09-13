import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AnalyticsEvent } from '../models/analytics.js';
import { Enquiry, Review } from '../models/commerce.js';
import { Product } from '../models/catalog.js';
import { Banner, HomepageSection, OfferPopup, Page } from '../models/admin-content.js';
import { validate } from '../middleware/validate.js';
import { presentProductCard } from '../presenters/product.js';
import { responsiveUrl } from '../services/media/cloudinary.js';
import { analyticsLimiter, readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { classifySource, hashIp, resolveGeo } from '../services/geo.js';
import { getSettings } from '../services/settings.js';
import { checkPincodeServiceability, lookupPincode } from '../services/shipping/shiprocket.js';
import { getPublicKeyId, razorpayEnabled } from '../services/payment/razorpay.js';
import { objectId } from '../schemas/cart.js';
import { ANALYTICS_EVENTS } from '../domain/constants.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* GET /api/config — everything the storefront needs at boot                   */
/* -------------------------------------------------------------------------- */

router.get('/config', readLimiter, async (req: Request, res: Response) => {
  const geo = resolveGeo(req);
  const settings = await getSettings();

  res.json({
    // Public contact details, editable by the admin (README §24).
    whatsappNumber: settings.whatsappNumber,
    callNumber: settings.callNumber,
    currency: geo.currency,
    country: geo.country,
    usdRateInr: settings.usdRateInr,
    codAllowed: geo.codAllowed,
    shippingFlatInr: settings.shippingFlatInr,
    freeShippingAboveInr: settings.freeShippingAboveInr,
    razorpay: { enabled: razorpayEnabled(), keyId: getPublicKeyId() },
    googleClientId: env.GOOGLE_CLIENT_ID,
    appBaseUrl: env.APP_BASE_URL,
    homeFeedMode: settings.homeFeedMode,
    homeFeedOrder: settings.homeFeedOrder.split(','),
    homeFeedPageSize: settings.homeFeedPageSize,
    // Lace/latkan colour picker popups — admin-controlled per accessory type.
    laceColorPickerEnabled: settings.laceColorPickerEnabled,
    latkanColorPickerEnabled: settings.latkanColorPickerEnabled,
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/events — analytics ingest (README §76)                            */
/* -------------------------------------------------------------------------- */

const eventSchema = z
  .object({
    type: z.enum(ANALYTICS_EVENTS),
    sessionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/),
    productId: objectId.nullable().optional(),
    path: z.string().trim().max(300).default(''),
    referrer: z.string().trim().max(300).default(''),
    query: z.string().trim().max(120).default(''),
    durationMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).default(0),
    value: z.number().finite().min(-1e9).max(1e9).default(0),
    utm: z
      .object({
        source: z.string().trim().max(60).default(''),
        medium: z.string().trim().max(60).default(''),
        campaign: z.string().trim().max(60).default(''),
      })
      .strict()
      .optional(),
    device: z
      .object({
        type: z.string().trim().max(20).default(''),
        os: z.string().trim().max(40).default(''),
        browser: z.string().trim().max(40).default(''),
        screen: z.string().trim().max(20).default(''),
      })
      .strict()
      .optional(),
  })
  .strict();

const eventBatchSchema = z.object({ events: z.array(eventSchema).min(1).max(20) }).strict();

/**
 * Events arrive batched from the browser, usually on page hide. Two notes:
 *
 *  - The IP is hashed, never stored (README §63 asks for privacy care here).
 *  - Writes are fire-and-forget: analytics must never slow down or break the
 *    shopping experience, so the response goes out regardless.
 */
router.post('/events', analyticsLimiter, validate({ body: eventBatchSchema }), async (req: Request, res: Response) => {
  const { events } = (req as Request & { validated: { body: z.infer<typeof eventBatchSchema> } }).validated.body;
  const geo = resolveGeo(req);
  const ipHash = hashIp(req.ip);
  const userId = req.auth?.userId ?? null;

  const docs = events.map((event) => ({
    type: event.type,
    sessionId: event.sessionId,
    user: userId,
    product: event.productId ?? null,
    path: event.path,
    referrer: event.referrer,
    source: classifySource(event.referrer, event.utm?.source ?? ''),
    utm: event.utm ?? { source: '', medium: '', campaign: '' },
    device: event.device ?? { type: '', os: '', browser: '', screen: '' },
    geo: { country: geo.country, state: geo.state, city: geo.city },
    ipHash,
    durationMs: event.durationMs,
    value: event.value,
    query: event.query,
    at: new Date(),
  }));

  res.status(202).json({ ok: true, accepted: docs.length });

  // Keep the denormalised per-product counters in step (README §39).
  const increments = new Map<string, Record<string, number>>();
  const bump = (productId: string, field: string, by = 1) => {
    const current = increments.get(productId) ?? {};
    current[field] = (current[field] ?? 0) + by;
    increments.set(productId, current);
  };

  for (const event of events) {
    if (!event.productId) continue;
    switch (event.type) {
      case 'PRODUCT_VIEW':
        bump(event.productId, 'stats.views');
        break;
      case 'PRODUCT_VIEW_END':
        bump(event.productId, 'stats.totalViewMs', event.durationMs);
        bump(event.productId, 'stats.viewSessions');
        break;
      case 'IMAGE_ZOOM':
        bump(event.productId, 'stats.zooms');
        break;
      case 'CART_ADD':
        bump(event.productId, 'stats.cartAdds');
        break;
      case 'BUY_NOW':
        bump(event.productId, 'stats.buyNows');
        break;
      case 'WHATSAPP_CLICK':
        bump(event.productId, 'stats.whatsappEnquiries');
        break;
      case 'SHARE':
        bump(event.productId, 'stats.shares');
        break;
      default:
        break;
    }
  }

  try {
    await AnalyticsEvent.insertMany(docs, { ordered: false });
    if (increments.size > 0) {
      await Product.bulkWrite(
        [...increments.entries()].map(([productId, inc]) => ({
          updateOne: { filter: { _id: productId }, update: { $inc: inc } },
        })),
      );
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'analytics write failed');
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/enquiries — logs a WhatsApp tap (README §24)                      */
/* -------------------------------------------------------------------------- */

const enquirySchema = z
  .object({
    productId: objectId.nullable().optional(),
    channel: z.enum(['WHATSAPP', 'CALL', 'FORM']).default('WHATSAPP'),
    sessionId: z.string().trim().max(64).default(''),
    message: z.string().trim().max(1000).default(''),
  })
  .strict();

router.post('/enquiries', writeLimiter, validate({ body: enquirySchema }), async (req: Request, res: Response) => {
  const body = (req as Request & { validated: { body: z.infer<typeof enquirySchema> } }).validated.body;

  await Enquiry.create({
    product: body.productId ?? null,
    channel: body.channel,
    sessionId: body.sessionId,
    user: req.auth?.userId ?? null,
    message: body.message,
  });

  res.status(201).json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* GET /api/shipping/pincode/:pincode  (README §72)                            */
/* -------------------------------------------------------------------------- */

const pincodeParams = z.object({ pincode: z.string().trim().regex(/^\d{6}$/, 'Sahi pincode likhein.') }).strict();

router.get(
  '/shipping/pincode/:pincode',
  readLimiter,
  validate({ params: pincodeParams }),
  async (req: Request, res: Response) => {
    const { pincode } = (req as Request & { validated: { params: { pincode: string } } }).validated.params;
    const settings = await getSettings();
    const location = await lookupPincode(pincode);
    if (!location.valid) {
      res.json({ pincode, valid: false, serviceable: false, codAvailable: false, city: '', district: '', state: '', areas: [], estimatedDays: null, courier: '', shippingChargeInr: settings.shippingFlatInr, estimatedDeliveryText: 'Pincode verify nahi hua. Pincode check karein.' });
      return;
    }

    const result = await checkPincodeServiceability(pincode, '400001', 0.5, true);

    res.json({
      pincode,
      valid: true,
      city: location.city,
      district: location.district,
      state: location.state,
      areas: location.areas,
      serviceable: result.serviceable,
      codAvailable: result.codAvailable,
      estimatedDays: result.estimatedDays,
      courier: result.courier,
      shippingChargeInr: result.shippingChargeInr ?? settings.shippingFlatInr,
      estimatedDeliveryText: result.estimatedDays
        ? `Lagbhag ${result.estimatedDays} din mein delivery`
        : 'Delivery date order confirm hone par batayenge',
    });
  },
);

/* -------------------------------------------------------------------------- */
/* Reviews (README §34)                                                        */
/* -------------------------------------------------------------------------- */

router.get(
  '/reviews/:productId',
  readLimiter,
  validate({ params: z.object({ productId: objectId }).strict() }),
  async (req: Request, res: Response) => {
    const { productId } = (req as Request & { validated: { params: { productId: string } } }).validated.params;

    // Only approved reviews are ever public.
    const reviews = await Review.find({ product: productId, status: 'APPROVED' })
      .sort({ createdAt: -1 })
      .limit(30)
      .select('name rating text photos verifiedPurchase createdAt')
      .lean();

    res.json({
      items: reviews.map((review) => ({
        id: String(review._id),
        name: review.name,
        rating: review.rating,
        text: review.text,
        photos: review.photos ?? [],
        verifiedPurchase: review.verifiedPurchase,
        createdAt: review.createdAt,
      })),
    });
  },
);

const createReviewSchema = z
  .object({
    productId: objectId,
    name: z.string().trim().min(2).max(60),
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().max(1500).default(''),
  })
  .strict();

router.post('/reviews', writeLimiter, validate({ body: createReviewSchema }), async (req: Request, res: Response) => {
  const body = (req as Request & { validated: { body: z.infer<typeof createReviewSchema> } }).validated.body;

  // Created as PENDING; nothing a stranger writes appears on the site until an
  // admin approves it, which is also what keeps review spam off the page.
  await Review.create({
    product: body.productId,
    user: req.auth?.userId ?? null,
    name: body.name,
    rating: body.rating,
    text: body.text,
    status: 'PENDING',
  });

  res.status(201).json({ ok: true, message: 'Review bhej diya gaya. Approve hone ke baad dikhega. Dhanyawad!' });
});

/* -------------------------------------------------------------------------- */
/* Public admin-managed content (README §85.10–85.13)                          */
/* -------------------------------------------------------------------------- */

/**
 * Banners are admin-managed creatives with optional start/end windows. Only
 * active banners whose window (if set) contains "now" are returned.
 */
router.get('/banners', readLimiter, async (_req: Request, res: Response) => {
  const now = new Date();
  const items = await Banner.find({
    isActive: true,
    $or: [
      { startsAt: null, expiresAt: null },
      { startsAt: null, expiresAt: { $gte: now } },
      { startsAt: { $lte: now }, expiresAt: null },
      { startsAt: { $lte: now }, expiresAt: { $gte: now } },
    ],
  })
    .sort({ order: 1, createdAt: -1 })
    .lean();
  // The storefront consumes `id` (not MongoDB's `_id`) — see HomeBanner.
  res.json({
    items: items.map((b) => ({
      id: String(b._id),
      title: b.title,
      subtitle: b.subtitle,
      image: responsiveUrl(b.image, 1200),
      ctaText: b.ctaText,
      ctaLink: b.ctaLink,
      offerText: b.offerText,
      position: b.position,
      startsAt: b.startsAt,
      expiresAt: b.expiresAt,
    })),
  });
});

/**
 * Active promotional popup (README §85.14). One eligible campaign is picked
 * at random per request, so different sessions/users naturally see different
 * offers — the storefront then reserves that popup for the whole session.
 * Scheduled/expired popups (start/end windows) are never eligible, and the
 * popup stops being served the moment its end date passes.
 */
router.get('/offer-popup', readLimiter, async (req: Request, res: Response) => {
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;
  const now = new Date();

  const eligible = await OfferPopup.find({
    isActive: true,
    $or: [
      { startsAt: null, endsAt: null },
      { startsAt: { $lte: now }, endsAt: null },
      { startsAt: null, endsAt: { $gte: now } },
      { startsAt: { $lte: now }, endsAt: { $gte: now } },
    ],
  })
    .select('_id')
    .lean();

  if (eligible.length === 0) {
    res.json({ popup: null, currency: geo.currency });
    return;
  }

  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  if (!pick) {
    res.json({ popup: null, currency: geo.currency });
    return;
  }
  const doc = await OfferPopup.findById(pick._id).populate('productId').lean();

  if (!doc || !doc.productId) {
    res.json({ popup: null, currency: geo.currency });
    return;
  }

  const product = presentProductCard(doc.productId as never, geo.currency, fxRate);
  res.json({
    currency: geo.currency,
    popup: {
      id: String(doc._id),
      offerType: doc.offerType,
      headline: doc.headline,
      limited: doc.limited,
      startsAt: doc.startsAt,
      endsAt: doc.endsAt,
      delaySeconds: doc.delaySeconds,
      product,
    },
  });
});

/** Admin-ordered homepage sections (README §85.10: no developer needed). */
router.get('/homepage-sections', readLimiter, async (_req: Request, res: Response) => {
  const items = await HomepageSection.find({ isActive: true })
    .sort({ order: 1 })
    .populate('productIds', 'designId name slug images sellingPriceInr mrpInr type')
    .populate('categoryId', 'name slug')
    .lean();
  // Equal orders (empty-section presets used to save as 0) fall back to the
  // natural flow so a stray "Customize" row never outranks "Ready to Buy".
  const priority = (key: string): number =>
    ({ ready_to_buy: 0, customize: 1, new_designs: 2, trending: 3, featured: 4, showcase: 5 })[key] ?? 99;
  items.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const p = priority(a.key) - priority(b.key);
    if (p !== 0) return p;
    return String(a._id).localeCompare(String(b._id));
  });
  res.json({ items });
});

/** Static content pages (About, FAQ, policies… — README §85.12). */
router.get('/pages/:slug', readLimiter, validate({ params: z.object({ slug: z.string().trim().min(1).max(60) }).strict() }), async (req: Request, res: Response) => {
  const { slug } = (req as Request & { validated: { params: { slug: string } } }).validated.params;
  const page = await Page.findOne({ slug, isActive: true }).lean();
  if (!page) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page nahi mila.' } });
    return;
  }
  res.json({ page });
});

export default router;
