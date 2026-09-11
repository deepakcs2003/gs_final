import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Cart, Wishlist } from '../models/commerce.js';
import { Product } from '../models/catalog.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { quoteCart } from '../services/pricing.js';
import { resolveGeo } from '../services/geo.js';
import { getSettings } from '../services/settings.js';
import { presentProductCard } from '../presenters/product.js';
import { cartLinesSchema, couponCodeSchema, objectId } from '../schemas/cart.js';
import { estimateForQuote } from './orders.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* POST /api/cart/quote — the authoritative price of a cart                     */
/* -------------------------------------------------------------------------- */

const quoteSchema = z
  .object({
    lines: cartLinesSchema,
    couponCode: couponCodeSchema,
  })
  .strict();

/**
 * Called by the cart page and the checkout summary. Guests and signed-in users
 * hit the same endpoint: the cart itself may live in the browser, but what it
 * *costs* is always decided here.
 */
router.post('/quote', writeLimiter, validate({ body: quoteSchema }), async (req: Request, res: Response) => {
  const { lines, couponCode } = (req as Request & { validated: { body: z.infer<typeof quoteSchema> } }).validated.body;
  const geo = resolveGeo(req);

  const quote = await quoteCart(
    lines.map((line) => ({ ...line, laceIds: line.laceIds ?? [], latkanIds: line.latkanIds ?? [] })),
    { country: geo.country, couponCode, strict: false },
  );

  const hasCustom = quote.lines.some((line) => line.type === 'CUSTOMIZE');
  let deliveryEstimate: { stitchingWorkingDays: number; from: Date; to: Date } | undefined;
  if (hasCustom) {
    // Best-effort; checkout shows an exact snapshot only after an order exists.
    try {
      const estimate = await estimateForQuote(quote.lines);
      deliveryEstimate = {
        stitchingWorkingDays: estimate.estimate.stitchingWorkingDays,
        from: estimate.estimate.fromDate,
        to: estimate.estimate.toDate,
      };
    } catch {
      deliveryEstimate = undefined;
    }
  }

  res.json({ ...quote, deliveryEstimate });
});

/* -------------------------------------------------------------------------- */
/* Server-side cart for signed-in customers (README §26–27)                    */
/* -------------------------------------------------------------------------- */

router.get('/', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const cart = await Cart.findOne({ user: req.auth!.userId }).lean();
  res.json({ lines: cart?.items ?? [] });
});

const saveCartSchema = z.object({ lines: cartLinesSchema }).strict();

/**
 * Replaces the stored cart wholesale. The cart is scoped to `req.auth.userId`
 * from the signed token — never to an id in the request body — so one customer
 * can never write into another's cart.
 */
router.put('/', requireAuth, writeLimiter, validate({ body: saveCartSchema }), async (req: Request, res: Response) => {
  const { lines } = (req as Request & { validated: { body: z.infer<typeof saveCartSchema> } }).validated.body;

  const items = lines.map((line) => ({
    product: line.productId,
    type: 'READY_MADE' as const,
    quantity: line.quantity,
    colorSlug: line.colorSlug ?? '',
    size: line.size ?? null,
    fabric: line.fabricId ?? null,
    fabrics: line.fabricIds ?? (line.fabricId ? [line.fabricId] : []),
    laces: line.laceIds ?? [],
    laceColors: (line.laceColors ?? []).map((c) => ({ id: c.laceId, colorName: c.colorName, colorHex: c.colorHex ?? '' })),
    latkans: line.latkanIds ?? [],
    latkanColors: (line.latkanColors ?? []).map((c) => ({ id: c.latkanId, colorName: c.colorName, colorHex: c.colorHex ?? '' })),
    measurement: line.measurement ?? null,
    note: line.note ?? '',
  }));

  // The product type is authoritative from the catalogue, not from the client.
  const products = await Product.find({ _id: { $in: lines.map((l) => l.productId) } })
    .select('type')
    .lean();
  const typeById = new Map(products.map((p) => [String(p._id), p.type]));
  for (const item of items) {
    const type = typeById.get(String(item.product));
    if (type) (item as { type: string }).type = type;
  }

  await Cart.findOneAndUpdate(
    { user: req.auth!.userId },
    { $set: { items } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.json({ ok: true, count: items.length });
});

/* -------------------------------------------------------------------------- */
/* Wishlist (README §26)                                                       */
/* -------------------------------------------------------------------------- */

router.get('/wishlist', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const wishlist = await Wishlist.findOne({ user: req.auth!.userId })
    .populate({ path: 'products', match: { isActive: true } })
    .lean();

  const products = (wishlist?.products ?? []) as unknown as Array<Record<string, unknown>>;

  res.json({
    items: products.map((p) => presentProductCard(p as never, geo.currency, fxRate)),
    currency: geo.currency,
  });
});

const wishlistBodySchema = z.object({ productId: objectId }).strict();

router.post(
  '/wishlist',
  requireAuth,
  writeLimiter,
  validate({ body: wishlistBodySchema }),
  async (req: Request, res: Response) => {
    const { productId } = (req as Request & { validated: { body: { productId: string } } }).validated.body;

    // $addToSet keeps the operation idempotent — double taps on the heart on a
    // slow phone connection must not create duplicates.
    await Wishlist.updateOne(
      { user: req.auth!.userId },
      { $addToSet: { products: productId } },
      { upsert: true },
    );
    await Product.updateOne({ _id: productId }, { $inc: { 'stats.wishlists': 1 } });

    res.json({ ok: true });
  },
);

router.delete(
  '/wishlist/:productId',
  requireAuth,
  writeLimiter,
  validate({ params: z.object({ productId: objectId }).strict() }),
  async (req: Request, res: Response) => {
    const { productId } = (req as Request & { validated: { params: { productId: string } } }).validated.params;
    await Wishlist.updateOne({ user: req.auth!.userId }, { $pull: { products: productId } });
    res.json({ ok: true });
  },
);

/** Folds a guest's local wishlist into the account on first login. */
const mergeSchema = z.object({ productIds: z.array(objectId).max(200) }).strict();

router.post(
  '/wishlist/merge',
  requireAuth,
  writeLimiter,
  validate({ body: mergeSchema }),
  async (req: Request, res: Response) => {
    const { productIds } = (req as Request & { validated: { body: { productIds: string[] } } }).validated.body;

    if (productIds.length) {
      await Wishlist.updateOne(
        { user: req.auth!.userId },
        { $addToSet: { products: { $each: productIds } } },
        { upsert: true },
      );
    }

    res.json({ ok: true });
  },
);

export default router;
