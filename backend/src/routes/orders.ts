import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Order, Coupon } from '../models/commerce.js';
import { Product } from '../models/catalog.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { checkoutLimiter, readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { quoteCart, type QuotedLine } from '../services/pricing.js';
import { resolveGeo } from '../services/geo.js';
import { getSettings } from '../services/settings.js';
import { validateMeasurements } from '../services/measurements.js';
import { createRazorpayOrder, getPublicKeyId, razorpayEnabled, verifyCheckoutSignature } from '../services/payment/razorpay.js';
import { createShipment } from '../services/shipping/shiprocket.js';
import { getShiprocketSettings } from '../services/shipping/shiprocket-settings.js';
import { cartLinesSchema, couponCodeSchema } from '../schemas/cart.js';
import { logger } from '../utils/logger.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { ORDER_STATUS_LABELS, type OrderStatus, type ComplexityKey } from '../domain/constants.js';
import { detectComplexity, computeEstimate, type EstimateResult } from '../services/production.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Unpredictable order numbers: sequential ids would let anyone enumerate orders. */
function generateOrderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
  return `GS${stamp}${random}`;
}

const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    mobile: z
      .string()
      .trim()
      .max(20)
      .transform((raw) => raw.replace(/[\s()-]/g, '').replace(/^\+/, ''))
      .refine((v) => /^\d{10,15}$/.test(v), 'Sahi mobile number likhein.')
      .transform((v) => (v.length === 10 ? `91${v}` : v)),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
  })
  .strict();

const addressSchema = z
  .object({
    line1: z.string().trim().min(4).max(160),
    line2: z.string().trim().max(160).default(''),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().min(2).max(60),
    pincode: z.string().trim().regex(/^\d{4,10}$/, 'Sahi pincode likhein.'),
    country: z.string().trim().length(2).toUpperCase().default('IN'),
  })
  .strict();

const createOrderSchema = z
  .object({
    lines: cartLinesSchema.min(1),
    contact: contactSchema,
    address: addressSchema,
    paymentMethod: z.enum(['RAZORPAY', 'COD']),
    couponCode: couponCodeSchema,
    customerNote: z.string().trim().max(500).default(''),
  })
  .strict();

/**
 * Takes stock for the ready-made lines, one conditional update per line.
 *
 * The `stock: {$gte: qty}` guard inside the filter is what makes this safe under
 * concurrency: two shoppers racing for the last blouse both attempt the update,
 * and Mongo only lets one of them match. A read-then-write would oversell.
 * If any line fails, everything already taken is put back before we return.
 */
async function reserveStock(lines: QuotedLine[]): Promise<{ ok: true } | { ok: false; message: string }> {
  const taken: QuotedLine[] = [];

  for (const line of lines) {
    if (line.type !== 'READY_MADE') continue;

    const result = await Product.updateOne(
      {
        _id: line.productId,
        variants: { $elemMatch: { colorSlug: line.colorSlug, size: line.size, stock: { $gte: line.quantity } } },
      },
      { $inc: { 'variants.$.stock': -line.quantity } },
    );

    if (result.modifiedCount !== 1) {
      await releaseStock(taken);
      return { ok: false, message: `${line.name} (${line.colorName}, size ${line.size}) abhi stock mein nahi hai.` };
    }

    taken.push(line);
  }

  return { ok: true };
}

async function releaseStock(lines: QuotedLine[]): Promise<void> {
  for (const line of lines) {
    if (line.type !== 'READY_MADE') continue;
    await Product.updateOne(
      { _id: line.productId, variants: { $elemMatch: { colorSlug: line.colorSlug, size: line.size } } },
      { $inc: { 'variants.$.stock': line.quantity } },
    ).catch((err: unknown) => {
      logger.error({ err: (err as Error).message, productId: line.productId }, 'stock release failed');
    });
  }
}

/**
 * Delivery estimate for a quoted cart: highest-severity complexity across the
 * CUSTOMIZE lines, workload-aware stitching estimate, and a delivery range.
 */
export async function estimateForQuote(lines: QuotedLine[]): Promise<EstimateResult> {
  const custom = lines.filter((line) => line.type === 'CUSTOMIZE');
  let complexity: ComplexityKey = 'medium';
  let fallbackStitchingDays = 0;

  if (custom.length > 0) {
    const products = await Product.find({ _id: { $in: custom.map((line) => line.productId) } })
      .select('name embroidery tags stitchingDays')
      .lean();
    const severity: Record<ComplexityKey, number> = { simple: 1, medium: 2, designer: 3, heavy_designer: 4, bridal: 5 };
    for (const line of custom) {
      const product = products.find((p) => String(p._id) === line.productId);
      if (!product) continue;
      const detected = detectComplexity(product);
      if ((severity[detected] ?? 0) > (severity[complexity] ?? 0)) complexity = detected;
      fallbackStitchingDays = Math.max(fallbackStitchingDays, product.stitchingDays ?? 0);
    }
  }

  return computeEstimate({
    items: lines.map((line) => ({ type: line.type, quantity: line.quantity })),
    complexity,
    fallbackStitchingDays: fallbackStitchingDays || 7,
  });
}

/* -------------------------------------------------------------------------- */
/* POST /api/orders                                                            */
/* -------------------------------------------------------------------------- */

router.post('/', checkoutLimiter, validate({ body: createOrderSchema }), async (req: Request, res: Response) => {
  const body = (req as Request & { validated: { body: z.infer<typeof createOrderSchema> } }).validated.body;
  const geo = resolveGeo(req);
  const settings = await getSettings();

  // README §32 — COD is India-only. Enforced here, not just hidden in the UI.
  if (body.paymentMethod === 'COD' && !geo.codAllowed) {
    throw badRequest('Aapke country ke liye COD available nahi hai. Online payment karein.');
  }

  if (body.paymentMethod === 'RAZORPAY' && !razorpayEnabled()) {
    throw badRequest('Online payment abhi available nahi hai.');
  }

  // Every amount is recomputed from the database. Nothing the browser sent
  // about price, discount or shipping is trusted.
  const quote = await quoteCart(
    body.lines.map((line) => ({ ...line, laceIds: line.laceIds ?? [], latkanIds: line.latkanIds ?? [] })),
    { country: geo.country, couponCode: body.couponCode, strict: true },
  );

  if (quote.blocking) {
    const issues = quote.lines.flatMap((line) => line.issues);
    throw new AppError(409, 'CART_NOT_ORDERABLE', 'Cart mein kuch problem hai.', { details: { issues } });
  }

  if (quote.amounts.totalMinor <= 0) {
    throw badRequest('Cart khaali hai.');
  }

  // Per-user coupon limit: a registered user may only apply a coupon up to
  // `perUserLimit` times. Checked at order time (the DB is the source of
  // truth), not just in the pricing estimate. CANCELLED orders don't count.
  if (quote.amounts.couponCode && req.auth?.userId) {
    const coupon = await Coupon.findOne({ code: quote.amounts.couponCode }).lean();
    if (coupon && coupon.perUserLimit > 0) {
      const usedByUser = await Order.countDocuments({
        user: req.auth.userId,
        'amounts.couponCode': quote.amounts.couponCode,
        status: { $ne: 'CANCELLED' },
      });
      if (usedByUser >= coupon.perUserLimit) {
        throw badRequest('Yeh coupon aap already use kar chuke hain.');
      }
    }
  }

  // Normalise measurements to inches for the stitching team (README §44).
  const measurementByKey = new Map<string, { unit: string; values: Record<string, number>; confirmed: boolean }>();
  for (const line of body.lines) {
    if (!line.measurement) continue;
    const validation = await validateMeasurements(line.measurement);
    if (!validation.ok) {
      throw new AppError(400, 'INVALID_MEASUREMENT', 'Kuch measurement sahi nahi hai.', {
        details: { fields: validation.errors },
      });
    }
    measurementByKey.set(line.key, {
      unit: 'inch',
      values: validation.valuesInInches,
      confirmed: Boolean(line.measurement.confirmed),
    });
  }

  const reservation = await reserveStock(quote.lines);
  if (!reservation.ok) throw conflict(reservation.message);

  const isCod = body.paymentMethod === 'COD';
  const orderNumber = generateOrderNumber();

  // Review-first: every new order — paid or not — waits for an admin to confirm
  // it. Complexity + delivery estimate are snapshotted now and recomputed when
  // the admin confirms / assigns a tailor (workload changes).
  const estimate = await estimateForQuote(quote.lines);

  try {
    const order = await Order.create({
      orderNumber,
      user: req.auth?.userId ?? null,
      isGuest: !req.auth,
      contact: { name: body.contact.name, mobile: body.contact.mobile, email: body.contact.email ?? '' },
      address: body.address,
      currency: quote.currency,
      fxRateInr: quote.fxRateInr,
      items: quote.lines.map((line) => ({
        product: line.productId,
        type: line.type,
        designId: line.designId,
        name: line.name,
        slug: line.slug,
        image: line.image,
        quantity: line.quantity,
        colorName: line.colorName,
        colorSlug: line.colorSlug,
        size: line.size,
        sku: line.sku,
        fabricName: line.fabricName,
        fabricMaterial: line.fabricMaterial,
        fabricColorName: line.fabricColorName,
        fabricDetails: line.fabricDetails,
        laceNames: line.laceNames,
        laceDetails: line.laceDetails,
        latkanNames: line.latkanNames,
        latkanDetails: line.latkanDetails,
        measurement: measurementByKey.get(line.key)
          ? {
              unit: 'inch',
              values: measurementByKey.get(line.key)!.values,
              confirmed: measurementByKey.get(line.key)!.confirmed,
              instructionVersion: settings.measurementInstructionVersion,
            }
          : null,
        unitBaseMinor: line.unitBaseMinor,
        unitFabricMinor: line.unitFabricMinor,
        unitLaceMinor: line.unitLaceMinor,
        unitLatkanMinor: line.unitLatkanMinor,
        unitStitchingMinor: line.unitStitchingMinor,
        lineTotalMinor: line.lineTotalMinor,
        note: line.note,
      })),
      amounts: quote.amounts,
      payment: {
        method: body.paymentMethod,
        status: isCod && quote.amounts.codAdvanceMinor > 0 ? 'COD_ADVANCE_PENDING' : isCod ? 'COD_PENDING' : 'PENDING',
      },
      status: 'AWAITING_REVIEW',
      statusHistory: [{ status: 'AWAITING_REVIEW', at: new Date(), note: '' }],
      review: { status: 'PENDING', flags: [] },
      production: {
        complexity: estimate.complexity,
        productionUnits: estimate.productionUnits,
        estimatedWorkingDays: estimate.stitchingWorkingDays,
        calculatedAt: new Date(),
      },
      deliveryEstimate: {
        stitchingWorkingDays: estimate.estimate.stitchingWorkingDays,
        packingWorkingDays: estimate.estimate.packingWorkingDays,
        shippingDays: estimate.estimate.shippingDays,
        fromDate: estimate.estimate.fromDate,
        toDate: estimate.estimate.toDate,
        bufferDays: 0,
        calculatedAt: new Date(),
      },
      customerNote: body.customerNote,
      measurementInstructionVersion: settings.measurementInstructionVersion,
      placedAt: new Date(),
    });

    // Analytics counters (README §39).
    await Product.bulkWrite(
      quote.lines.map((line) => ({
        updateOne: { filter: { _id: line.productId }, update: { $inc: { 'stats.orders': 1 } } },
      })),
    ).catch(() => undefined);

    if (quote.amounts.couponCode) {
      // Conditional increment: usageLimit must not be overshot between the
      // quote and the order. The outer catch releases reserved stock for us.
      const couponClaim = await Coupon.updateOne(
        { code: quote.amounts.couponCode, $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        { $inc: { usedCount: 1 } },
      ).catch(() => null);
      if (couponClaim && couponClaim.matchedCount === 0) {
        throw conflict('Yeh coupon ab khatam ho gaya hai.');
      }
    }

    if (isCod) {
      if (quote.amounts.codAdvanceMinor <= 0) {
        // No advance required — but the order still waits for admin review
        // before stitching or shipping starts (pushToShiprocket fires there).
        await order.save();
        res.status(201).json({
          orderNumber: order.orderNumber,
          paymentMethod: 'COD',
          currency: order.currency,
          totalMinor: order.amounts.totalMinor,
          codAdvanceMinor: 0,
          codBalanceMinor: order.amounts.codBalanceMinor,
        });
        return;
      }

      const advanceOrder = await createRazorpayOrder({
        amountMinor: quote.amounts.codAdvanceMinor,
        currency: quote.currency,
        receipt: order.orderNumber,
        notes: { orderNumber: order.orderNumber, paymentType: 'COD_ADVANCE' },
      });
      order.payment.razorpayOrderId = advanceOrder.id;
      await order.save();
      res.status(201).json({
        orderNumber: order.orderNumber,
        paymentMethod: 'COD',
        razorpayOrderId: advanceOrder.id,
        razorpayKeyId: getPublicKeyId(),
        amountMinor: quote.amounts.codAdvanceMinor,
        totalMinor: quote.amounts.totalMinor,
        codAdvanceMinor: quote.amounts.codAdvanceMinor,
        codBalanceMinor: quote.amounts.codBalanceMinor,
        currency: quote.currency,
        prefill: { name: body.contact.name, contact: body.contact.mobile, email: body.contact.email ?? '' },
      });
      return;
    }

    const razorpayOrder = await createRazorpayOrder({
      amountMinor: quote.amounts.totalMinor,
      currency: quote.currency,
      receipt: order.orderNumber,
      notes: { orderNumber: order.orderNumber },
    });

    order.payment.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.status(201).json({
      orderNumber: order.orderNumber,
      paymentMethod: 'RAZORPAY',
      razorpayOrderId: razorpayOrder.id,
      // Public key id only — the secret never leaves the server.
      razorpayKeyId: getPublicKeyId(),
      amountMinor: quote.amounts.totalMinor,
      currency: quote.currency,
      prefill: { name: body.contact.name, contact: body.contact.mobile, email: body.contact.email ?? '' },
    });
  } catch (err) {
    // Anything after reservation failing means the customer holds stock they
    // never bought. Give it back.
    await releaseStock(quote.lines);
    throw err;
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/orders/:orderNumber/verify-payment                                */
/* -------------------------------------------------------------------------- */

const orderNumberParams = z.object({ orderNumber: z.string().trim().regex(/^GS[A-Z0-9]{6,20}$/) }).strict();

const verifySchema = z
  .object({
    razorpayOrderId: z.string().trim().max(80),
    razorpayPaymentId: z.string().trim().max(80),
    signature: z.string().trim().max(200),
  })
  .strict();

/**
 * The browser reports a successful payment here. The report is only believed
 * because of the HMAC signature, which only Razorpay and this server can
 * produce — the webhook is the backstop if the customer closes the tab.
 */
router.post(
  '/:orderNumber/verify-payment',
  writeLimiter,
  validate({ params: orderNumberParams, body: verifySchema }),
  async (req: Request, res: Response) => {
    const { params, body } = (req as Request & {
      validated: { params: { orderNumber: string }; body: z.infer<typeof verifySchema> };
    }).validated;

    const order = await Order.findOne({ orderNumber: params.orderNumber });
    if (!order) throw notFound('Yeh order nahi mila.');

    // Idempotent: a previous verify call, or the webhook, may already have
    // settled this order. Never process a second time.
    if (order.payment.status === 'PAID' || order.payment.status === 'COD_ADVANCE_PAID') {
      res.json({ ok: true, orderNumber: order.orderNumber, status: order.status });
      return;
    }

    if (order.payment.razorpayOrderId !== body.razorpayOrderId) {
      throw badRequest('Payment details match nahi ho rahe.');
    }

    if (!verifyCheckoutSignature({
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      signature: body.signature,
    })) {
      // Deliberately does NOT mark the order FAILED or release stock here:
      // the order number is a low-trust identifier, so anyone could otherwise
      // force a live order to FAILED (griefing / IDOR). The signed Razorpay
      // webhook (`payment.failed`) is the authoritative failure path.
      logger.warn({ orderNumber: order.orderNumber }, 'razorpay checkout signature verification failed');
      throw badRequest('Payment verify nahi ho paya. Paisa kata hai to 3-4 din mein wapas aa jayega.');
    }

    if (order.payment.method === 'COD') await markCodAdvancePaid(order, body.razorpayPaymentId);
    else await markPaid(order, body.razorpayPaymentId);

    res.json({ ok: true, orderNumber: order.orderNumber, status: order.status });
  },
);

/* -------------------------------------------------------------------------- */
/* Order lookup                                                                */
/* -------------------------------------------------------------------------- */

router.get('/', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const orders = await Order.find({ user: req.auth!.userId }).sort({ placedAt: -1 }).limit(50).lean();
  res.json({ items: orders.map((order) => presentOrder(order)) });
});

/**
 * A guest has no account to authorise against, so tracking requires the order
 * number *and* the mobile number on the order. The order number is
 * unguessable, and this endpoint is rate-limited, so the pair is a reasonable
 * bearer credential for read-only tracking.
 */
const trackQuerySchema = z
  .object({
    mobile: z
      .string()
      .trim()
      .max(20)
      .transform((raw) => raw.replace(/[\s()+-]/g, ''))
      .transform((v) => (v.length === 10 ? `91${v}` : v))
      .optional(),
  })
  .strict();

router.get(
  '/:orderNumber',
  readLimiter,
  validate({ params: orderNumberParams, query: trackQuerySchema }),
  async (req: Request, res: Response) => {
    const { params, query } = (req as Request & {
      validated: { params: { orderNumber: string }; query: { mobile?: string } };
    }).validated;

    const order = await Order.findOne({ orderNumber: params.orderNumber }).lean();
    if (!order) throw notFound('Yeh order nahi mila.');

    const ownedByCaller = req.auth && order.user && String(order.user) === req.auth.userId;
    const matchesMobile = Boolean(query.mobile) && order.contact.mobile === query.mobile;

    if (!ownedByCaller && !matchesMobile) {
      // Same message as "not found" — confirming an order exists to someone who
      // cannot open it is itself a leak.
      throw notFound('Yeh order nahi mila.');
    }

    res.json({ order: presentOrder(order, true) });
  },
);

/* -------------------------------------------------------------------------- */
/* Shared order helpers (also used by the webhook)                             */
/* -------------------------------------------------------------------------- */

interface OrderItemLike {
  name: string;
  designId: string;
  slug: string;
  image: string;
  quantity: number;
  type: string;
  colorName: string;
  size?: number | null;
  fabricName: string;
  fabricDetails?: Array<{ name?: string | null; material?: string | null; colorName?: string | null; image?: string | null }>;
  laceNames?: string[];
  laceDetails?: Array<{ name?: string | null; colorName?: string | null; image?: string | null }>;
  latkanNames?: string[];
  latkanDetails?: Array<{ name?: string | null; colorName?: string | null; image?: string | null }>;
  lineTotalMinor: number;
}

interface OrderLike {
  orderNumber: string;
  currency: string;
  items: OrderItemLike[];
  amounts: { totalMinor: number; subtotalMinor: number; discountMinor: number; shippingMinor: number; couponCode: string; codAdvanceMinor: number; codBalanceMinor: number };
  payment: { method: string; status: string };
  status: string;
  statusHistory?: Array<{ status: string; at: Date; note?: string }>;
  shipping?: {
    awb?: string;
    courier?: string;
    trackingUrl?: string;
    estimatedDeliveryAt?: Date | null;
    status?: string;
    statusText?: string;
    lastSyncedAt?: Date | null;
  } | null;
  address?: unknown;
  contact?: unknown;
  customerNote?: string;
  placedAt?: Date;
  deliveryEstimate?: {
    stitchingWorkingDays?: number;
    packingWorkingDays?: number;
    shippingDays?: number;
    fromDate?: Date | null;
    toDate?: Date | null;
  } | null;
}

function presentOrder(order: OrderLike, detailed = false) {
  const base = {
    orderNumber: order.orderNumber,
    currency: order.currency,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status,
    placedAt: order.placedAt,
    totalMinor: order.amounts.totalMinor,
    paymentMethod: order.payment.method,
    paymentStatus: order.payment.status,
    itemCount: order.items.length,
    items: order.items.map((item) => ({
      name: item.name,
      designId: item.designId,
      slug: item.slug,
      image: item.image,
      quantity: item.quantity,
      type: item.type,
      colorName: item.colorName,
      size: item.size,
      fabricName: item.fabricName,
      fabricDetails: (item.fabricDetails ?? []).map((detail) => ({ name: detail.name ?? '', material: detail.material ?? '', colorName: detail.colorName ?? '', image: detail.image ?? '' })),
      laceNames: item.laceNames ?? [],
      laceDetails: (item.laceDetails ?? []).map((detail) => ({ name: detail.name ?? '', colorName: detail.colorName ?? '', image: detail.image ?? '' })),
      latkanNames: item.latkanNames ?? [],
      latkanDetails: (item.latkanDetails ?? []).map((detail) => ({ name: detail.name ?? '', colorName: detail.colorName ?? '', image: detail.image ?? '' })),
      lineTotalMinor: item.lineTotalMinor,
    })),
  };

  if (!detailed) return base;

  return {
    ...base,
    amounts: order.amounts,
    address: order.address,
    contact: order.contact,
    customerNote: order.customerNote ?? '',
    // Never expose the Razorpay payment id or internal shipping ids to a guest.
    timeline: (order.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      label: ORDER_STATUS_LABELS[entry.status as OrderStatus] ?? entry.status,
      at: entry.at,
    })),
    // Customer-safe delivery range — never exposes internal workload or tailors.
    deliveryEstimate: order.deliveryEstimate?.fromDate && order.deliveryEstimate?.toDate
      ? {
          stitchingWorkingDays: order.deliveryEstimate.stitchingWorkingDays ?? 0,
          from: order.deliveryEstimate.fromDate,
          to: order.deliveryEstimate.toDate,
        }
      : null,
    tracking: {
      awb: order.shipping?.awb ?? '',
      courier: order.shipping?.courier ?? '',
      trackingUrl: order.shipping?.trackingUrl ?? '',
      estimatedDeliveryAt: order.shipping?.estimatedDeliveryAt ?? null,
      status: order.shipping?.status ?? 'NOT_SHIPPED',
      statusText: order.shipping?.statusText ?? '',
      lastSyncedAt: order.shipping?.lastSyncedAt ?? null,
    },
  };
}

/**
 * Money arrived. The order itself stays AWAITING_REVIEW — confirmation is an
 * admin decision (review-first policy), not an automatic side-effect of being
 * paid. Shipping is pushed only after the admin confirms.
 */
export async function markPaid(order: InstanceType<typeof Order>, paymentId: string): Promise<void> {
  if (order.payment.status === 'PAID') return;

  order.payment.status = 'PAID';
  order.payment.razorpayPaymentId = paymentId;
  order.payment.verifiedAt = new Date();
  order.payment.paidAt = new Date();

  // Late webhook: payment arrived after the order was marked FAILED (e.g.
  // retry succeeded, or the browser verify was skipped). Restore to
  // AWAITING_REVIEW so the admin can process it under the review-first flow.
  if (order.status === 'FAILED') {
    order.status = 'AWAITING_REVIEW';
    order.statusHistory.push({ status: 'AWAITING_REVIEW', at: new Date(), note: 'Payment received after earlier failure' });
  }

  await order.save();
}

export async function markCodAdvancePaid(order: InstanceType<typeof Order>, paymentId: string): Promise<void> {
  if (order.payment.status === 'COD_ADVANCE_PAID') return;
  order.payment.status = 'COD_ADVANCE_PAID';
  order.payment.razorpayPaymentId = paymentId;
  order.payment.verifiedAt = new Date();
  order.payment.paidAt = new Date();

  // Same late-arrival restore as markPaid — a failed COD advance that later
  // lands should go back to the review queue, not stay FAILED.
  if (order.status === 'FAILED') {
    order.status = 'AWAITING_REVIEW';
    order.statusHistory.push({ status: 'AWAITING_REVIEW', at: new Date(), note: 'COD advance received after earlier failure' });
  }

  await order.save();
}

export async function markPaymentFailed(order: InstanceType<typeof Order>, reason: string): Promise<void> {
  if (order.payment.status === 'PAID' || order.payment.status === 'FAILED') return;

  order.payment.status = 'FAILED';
  order.payment.failureReason = reason.slice(0, 120);
  order.status = 'FAILED';
  order.statusHistory.push({ status: 'FAILED', at: new Date(), note: 'Payment failed' });
  await order.save();
  await releaseStockForOrder(order);
}

export async function releaseStockForOrder(order: InstanceType<typeof Order>): Promise<void> {
  for (const item of order.items) {
    if (item.type !== 'READY_MADE') continue;
    await Product.updateOne(
      { _id: item.product, variants: { $elemMatch: { colorSlug: item.colorSlug, size: item.size } } },
      { $inc: { 'variants.$.stock': item.quantity } },
    ).catch((err: unknown) => {
      logger.error({ err: (err as Error).message, orderNumber: order.orderNumber }, 'stock release failed');
    });
  }
}

/**
 * Fire-and-forget: courier problems must not fail a paid order. Called from
 * the admin confirm endpoint once a reviewed order is approved.
 */
export async function pushToShiprocket(orderId: string): Promise<void> {
  try {
    const [order, srSettings] = await Promise.all([
      Order.findById(orderId),
      getShiprocketSettings(),
    ]);
    if (!order) return;
    // Duplicate protection: the webhook and the browser callback both routinely
    // arrive — never create a second Shiprocket order for the same order.
    if (order.shipping.shiprocketOrderId) return;
    // Auto-create stays OFF until the real flow has been verified (spec STEP 15).
    if (!srSettings.autoCreate) return;

    const result = await createShipment(order, srSettings.pickupLocation);
    order.shipping.provider = 'SHIPROCKET';
    order.shipping.shiprocketOrderId = result.shiprocketOrderId;
    order.shipping.shipmentId = result.shipmentId;
    order.shipping.status = 'SHIPMENT_CREATED';
    await order.save();
  } catch (err) {
    // Never mark the order SHIPPED off a failed push — flag for manual retry.
    await Order.updateOne(
      { _id: orderId },
      { $set: { 'shipping.provider': 'SHIPROCKET', 'shipping.status': 'SHIPMENT_CREATION_FAILED' } },
    ).catch(() => undefined);
    logger.error({ err: (err as Error).message, orderId }, 'shiprocket push failed');
  }
}

export default router;
