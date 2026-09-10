import { Types } from 'mongoose';
import { Product } from '../models/catalog.js';
import { Fabric, Lace, Latkan } from '../models/catalog.js';
import { Coupon } from '../models/commerce.js';
import { getSettings } from './settings.js';
import { currencyForCountry, isCodAllowed } from './geo.js';
import { isMeasurementReady } from './measurements.js';
import type { Currency, ProductType } from '../domain/constants.js';

/**
 * Server-authoritative pricing.
 *
 * The client sends *what* the customer chose — product, colour, size, fabric,
 * quantity — and never *what it costs*. Every rupee in an order is recomputed
 * here from the database, so tampering with the cart in the browser changes
 * nothing. This function is the single source of truth used by both the cart
 * page and checkout.
 */

export interface CartLineInput {
  /** Client-side identity for the line, echoed back so the UI can match rows. */
  key: string;
  productId: string;
  quantity: number;
  colorSlug?: string;
  size?: number | null;
  fabricId?: string | null;
  fabricIds?: string[];
  laceIds?: string[];
  /** Chosen colour per lace — folded into `laceNames` as "Name (Colour)". */
  laceColors?: Array<{ laceId: string; colorName: string; colorHex?: string }>;
  latkanIds?: string[];
  /** Chosen colour per latkan — folded into `latkanNames` as "Name (Colour)". */
  latkanColors?: Array<{ latkanId: string; colorName: string; colorHex?: string }>;
  measurement?: { unit: 'inch' | 'cm'; values: Record<string, number>; confirmed?: boolean } | null;
  note?: string;
}

export interface QuoteContext {
  country: string;
  couponCode?: string;
  /** Checkout enforces blocking issues; the cart page only displays them. */
  strict?: boolean;
}

export interface QuotedLine {
  key: string;
  productId: string;
  type: ProductType;
  designId: string;
  name: string;
  slug: string;
  image: string;
  quantity: number;

  colorName: string;
  colorSlug: string;
  size: number | null;
  sku: string;

  fabricId: string | null;
  fabricName: string;
  fabricMaterial: string;
  fabricColorName: string;
  laceIds: string[];
  laceNames: string[];
  latkanIds: string[];
  latkanNames: string[];

  measurementReady: boolean;
  note: string;

  unitBaseMinor: number;
  unitFabricMinor: number;
  unitLaceMinor: number;
  unitLatkanMinor: number;
  unitStitchingMinor: number;
  unitTotalMinor: number;
  lineTotalMinor: number;

  /** Non-empty means this line cannot be ordered as-is. */
  issues: string[];
  /** Real inventory number, used for "Only 2 left" (README §67). */
  stockLeft: number | null;
}

export interface CartQuote {
  currency: Currency;
  fxRateInr: number;
  codAllowed: boolean;
  lines: QuotedLine[];
  amounts: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    totalMinor: number;
    couponCode: string;
  };
  couponError: string;
  /** True for foreign orders: delivery is quoted at payment time (README §32). */
  shippingChargedLater: boolean;
  blocking: boolean;
}

const MAX_LINES = 30;

/** Converts whole rupees into the order currency's minor unit (paise / cents). */
export function toMinor(inr: number, currency: Currency, usdRateInr: number): number {
  if (currency === 'INR') return Math.round(inr * 100);
  return Math.round((inr / usdRateInr) * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

function objectIdOrNull(value: unknown): Types.ObjectId | null {
  return typeof value === 'string' && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

export async function quoteCart(inputLines: CartLineInput[], ctx: QuoteContext): Promise<CartQuote> {
  const settings = await getSettings();
  const currency = currencyForCountry(ctx.country);
  const fxRateInr = currency === 'INR' ? 1 : settings.usdRateInr;
  const lines = inputLines.slice(0, MAX_LINES);

  // Bulk-load everything referenced, so pricing is a fixed number of queries
  // no matter how many lines the cart has.
  const productIds = lines.map((l) => objectIdOrNull(l.productId)).filter((id): id is Types.ObjectId => id !== null);
  const fabricIds = lines
    .flatMap((l) => l.fabricIds?.length ? l.fabricIds : [l.fabricId])
    .map(objectIdOrNull)
    .filter((id): id is Types.ObjectId => id !== null);
  const laceIds = lines
    .flatMap((l) => l.laceIds ?? [])
    .map(objectIdOrNull)
    .filter((id): id is Types.ObjectId => id !== null);
  const latkanIds = lines
    .flatMap((l) => l.latkanIds ?? [])
    .map(objectIdOrNull)
    .filter((id): id is Types.ObjectId => id !== null);

  const [products, fabrics, laces, latkans] = await Promise.all([
    productIds.length ? Product.find({ _id: { $in: productIds }, isActive: true }).lean() : Promise.resolve([]),
    fabricIds.length ? Fabric.find({ _id: { $in: fabricIds }, isActive: true }).lean() : Promise.resolve([]),
    laceIds.length ? Lace.find({ _id: { $in: laceIds }, isActive: true }).lean() : Promise.resolve([]),
    latkanIds.length ? Latkan.find({ _id: { $in: latkanIds }, isActive: true }).lean() : Promise.resolve([]),
  ]);

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const fabricMap = new Map(fabrics.map((f) => [String(f._id), f]));
  const laceMap = new Map(laces.map((l) => [String(l._id), l]));
  const latkanMap = new Map(latkans.map((l) => [String(l._id), l]));

  const quoted: QuotedLine[] = [];

  for (const line of lines) {
    const product = productMap.get(String(line.productId));
    const quantity = Math.min(Math.max(Math.trunc(line.quantity) || 1, 1), 20);

    if (!product) {
      quoted.push(emptyLine(line, quantity, ['Yeh design ab available nahi hai.']));
      continue;
    }

    const issues: string[] = [];
    const type = product.type as ProductType;

    // Showcase designs are display-only (README §25) — never sellable.
    if (type === 'SHOWCASE') {
      issues.push('Yeh design abhi sirf showcase ke liye hai, order nahi ho sakta.');
    }

    let colorName = '';
    let colorSlug = '';
    let size: number | null = null;
    let sku = '';
    let stockLeft: number | null = null;

    if (type === 'READY_MADE') {
      const color = (product.colors ?? []).find((c) => c.slug === line.colorSlug);
      const requestedSize = typeof line.size === 'number' ? line.size : null;

      if (!color) {
        issues.push('Color select karein.');
      } else {
        colorName = color.name;
        colorSlug = color.slug;
      }

      if (requestedSize === null || !(product.sizes ?? []).includes(requestedSize)) {
        issues.push('Size select karein.');
      } else {
        size = requestedSize;
      }

      if (color && size !== null) {
        const variant = (product.variants ?? []).find((v) => v.colorSlug === color.slug && v.size === size);
        stockLeft = variant?.stock ?? 0;
        sku = variant?.sku ?? '';
        if (!variant || variant.stock <= 0) {
          issues.push(`${color.name} — Size ${size} out of stock hai.`);
        } else if (variant.stock < quantity) {
          issues.push(`${color.name} — Size ${size} mein sirf ${variant.stock} bache hain.`);
        }
      }
    }

    let fabricUnitInr = 0;
    let laceUnitInr = 0;
    let latkanUnitInr = 0;
    let stitchingUnitInr = 0;
    let fabricName = '';
    let fabricMaterial = '';
    let fabricColorName = '';
    const laceNames: string[] = [];
    const chosenLaceIds: string[] = [];
    const latkanNames: string[] = [];
    const chosenLatkanIds: string[] = [];

    if (type === 'CUSTOMIZE') {
      const requestedFabricIds = (line.fabricIds?.length ? line.fabricIds : line.fabricId ? [line.fabricId] : []).slice(0, 6);
      const fabrics = requestedFabricIds.map((id) => fabricMap.get(String(id))).filter((fabric): fabric is NonNullable<typeof fabric> => Boolean(fabric));

      if (fabrics.length === 0) {
        issues.push('Fabric choose karein.');
      } else {
        if (fabrics.length < (product.minFabricCount ?? 1)) issues.push(`Is blouse mein minimum ${product.minFabricCount ?? 1} fabric choose karein.`);
        if (fabrics.length > (product.maxFabricCount ?? 1)) issues.push(`Is blouse mein maximum ${product.maxFabricCount ?? 1} fabric choose kar sakte hain.`);
        for (const fabric of fabrics) {
          const allowed = !product.fabricOptions?.length || product.fabricOptions.some((id) => String(id) === String(fabric._id));
          if (!allowed) issues.push('Yeh fabric is design ke liye available nahi hai.');
          else if (!fabric.inStock) issues.push(`${fabric.colorName} ${fabric.name} abhi out of stock hai.`);
          else {
            fabricUnitInr += fabric.priceInr;
            fabricName = fabricName ? `${fabricName}, ${fabric.name}` : fabric.name;
            fabricMaterial = fabricMaterial ? `${fabricMaterial}, ${fabric.material}` : fabric.material;
            fabricColorName = fabricColorName ? `${fabricColorName}, ${fabric.colorName}` : fabric.colorName;
          }
        }
      }

      const laceColorBy = new Map((line.laceColors ?? []).slice(0, 6).map((c) => [String(c.laceId), c.colorName]));
      if ((line.laceIds ?? []).length < (product.minLaceCount ?? 1)) issues.push(`Is blouse mein minimum ${product.minLaceCount ?? 1} lace choose karein.`);
      if ((line.laceIds ?? []).length > (product.maxLaceCount ?? 1)) issues.push(`Is blouse mein maximum ${product.maxLaceCount ?? 1} laces choose kar sakte hain.`);
      for (const rawId of (line.laceIds ?? []).slice(0, 6)) {
        const lace = laceMap.get(String(rawId));
        if (!lace) continue;
        const allowed = !product.laceOptions?.length || product.laceOptions.some((id) => String(id) === String(lace._id));
        if (!allowed || !lace.inStock) {
          issues.push(`${lace.name} lace abhi available nahi hai.`);
          continue;
        }
        laceUnitInr += lace.priceInr;
        const color = laceColorBy.get(String(lace._id));
        laceNames.push(color && color !== lace.colorName ? `${lace.name} (${color})` : lace.name);
        chosenLaceIds.push(String(lace._id));
      }

      const latkanColorBy = new Map((line.latkanColors ?? []).slice(0, 6).map((c) => [String(c.latkanId), c.colorName]));
      if ((line.latkanIds ?? []).length < (product.minLatkanCount ?? 1)) issues.push(`Is blouse mein minimum ${product.minLatkanCount ?? 1} latkan choose karein.`);
      if ((line.latkanIds ?? []).length > (product.maxLatkanCount ?? 1)) issues.push(`Is blouse mein maximum ${product.maxLatkanCount ?? 1} latkans choose kar sakte hain.`);
      for (const rawId of (line.latkanIds ?? []).slice(0, 6)) {
        const latkan = latkanMap.get(String(rawId));
        if (!latkan) continue;
        const allowed =
          !product.latkanOptions?.length || product.latkanOptions.some((id) => String(id) === String(latkan._id));
        if (!allowed || !latkan.inStock) {
          issues.push(`${latkan.name} latkan abhi available nahi hai.`);
          continue;
        }
        latkanUnitInr += latkan.priceInr;
        const color = latkanColorBy.get(String(latkan._id));
        latkanNames.push(color && color !== latkan.colorName ? `${latkan.name} (${color})` : latkan.name);
        chosenLatkanIds.push(String(latkan._id));
      }

      stitchingUnitInr = product.stitchingChargeInr ?? 0;

      // Measurements are only *required* to complete an order; an unmeasured
      // line may sit in the cart showing "Measurement Pending" (README §27).
      if (ctx.strict && !isMeasurementReady(line.measurement)) {
        issues.push('Measurement complete karein.');
      }
    }

    const unitBaseMinor = toMinor(product.sellingPriceInr, currency, fxRateInr);
    const unitFabricMinor = toMinor(fabricUnitInr, currency, fxRateInr);
    const unitLaceMinor = toMinor(laceUnitInr, currency, fxRateInr);
    const unitLatkanMinor = toMinor(latkanUnitInr, currency, fxRateInr);
    const unitStitchingMinor = toMinor(stitchingUnitInr, currency, fxRateInr);
    const unitTotalMinor = unitBaseMinor + unitFabricMinor + unitLaceMinor + unitLatkanMinor + unitStitchingMinor;

    quoted.push({
      key: line.key,
      productId: String(product._id),
      type,
      designId: product.designId,
      name: product.name,
      slug: product.slug,
      image: product.images?.[0]?.url ?? '',
      quantity,
      colorName,
      colorSlug,
      size,
      sku,
      fabricId: line.fabricId ? String(line.fabricId) : null,
      fabricName,
      fabricMaterial,
      fabricColorName,
      laceIds: chosenLaceIds,
      laceNames,
      latkanIds: chosenLatkanIds,
      latkanNames,
      measurementReady: type === 'CUSTOMIZE' ? isMeasurementReady(line.measurement) : true,
      note: (line.note ?? '').slice(0, 300),
      unitBaseMinor,
      unitFabricMinor,
      unitLaceMinor,
      unitLatkanMinor,
      unitStitchingMinor,
      unitTotalMinor,
      lineTotalMinor: unitTotalMinor * quantity,
      issues,
      stockLeft,
    });
  }

  const sellableLines = quoted.filter((l) => l.issues.length === 0);
  const subtotalMinor = sellableLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);

  const { discountMinor, couponCode, couponError } = await applyCoupon(
    ctx.couponCode,
    sellableLines,
    subtotalMinor,
    currency,
    fxRateInr,
  );

  // Foreign orders: delivery is quoted at payment time (README §32).
  const shippingChargedLater = currency !== 'INR';
  const subtotalAfterDiscountMinor = Math.max(subtotalMinor - discountMinor, 0);
  const shippingMinor =
    shippingChargedLater || subtotalMinor === 0
      ? 0
      : subtotalAfterDiscountMinor >= toMinor(settings.freeShippingAboveInr, currency, fxRateInr)
        ? 0
        : toMinor(settings.shippingFlatInr, currency, fxRateInr);

  return {
    currency,
    fxRateInr,
    codAllowed: isCodAllowed(ctx.country),
    lines: quoted,
    amounts: {
      subtotalMinor,
      discountMinor,
      shippingMinor,
      totalMinor: subtotalAfterDiscountMinor + shippingMinor,
      couponCode,
    },
    couponError,
    shippingChargedLater,
    blocking: quoted.some((l) => l.issues.length > 0),
  };
}

async function applyCoupon(
  rawCode: string | undefined,
  lines: QuotedLine[],
  subtotalMinor: number,
  currency: Currency,
  fxRateInr: number,
): Promise<{ discountMinor: number; couponCode: string; couponError: string }> {
  const code = (rawCode ?? '').trim().toUpperCase();
  if (!code) return { discountMinor: 0, couponCode: '', couponError: '' };
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
    return { discountMinor: 0, couponCode: '', couponError: 'Coupon code sahi nahi hai.' };
  }

  const now = new Date();
  const coupon = await Coupon.findOne({ code, isActive: true }).lean();

  if (!coupon) return { discountMinor: 0, couponCode: '', couponError: 'Yeh coupon valid nahi hai.' };
  if (coupon.startsAt && coupon.startsAt > now) {
    return { discountMinor: 0, couponCode: '', couponError: 'Yeh coupon abhi shuru nahi hua.' };
  }
  if (coupon.expiresAt && coupon.expiresAt < now) {
    return { discountMinor: 0, couponCode: '', couponError: 'Yeh coupon expire ho gaya.' };
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { discountMinor: 0, couponCode: '', couponError: 'Yeh coupon khatam ho gaya.' };
  }

  // Restricted coupons only discount the lines they actually cover.
  const restricted = (coupon.products?.length ?? 0) > 0;
  const eligibleMinor = restricted
    ? lines
        .filter((l) => coupon.products.some((id) => String(id) === l.productId))
        .reduce((sum, l) => sum + l.lineTotalMinor, 0)
    : subtotalMinor;

  if (eligibleMinor === 0) {
    return { discountMinor: 0, couponCode: '', couponError: 'Yeh coupon in products par nahi chalega.' };
  }

  const minOrderMinor = toMinor(coupon.minOrderInr ?? 0, currency, fxRateInr);
  if (subtotalMinor < minOrderMinor) {
    return {
      discountMinor: 0,
      couponCode: '',
      couponError: `Is coupon ke liye minimum order ${currency === 'INR' ? '₹' : '$'}${fromMinor(minOrderMinor)} hona chahiye.`,
    };
  }

  let discountMinor =
    coupon.type === 'PERCENT'
      ? Math.floor((eligibleMinor * Math.min(coupon.value, 100)) / 100)
      : toMinor(coupon.value, currency, fxRateInr);

  const capMinor = toMinor(coupon.maxDiscountInr ?? 0, currency, fxRateInr);
  if (capMinor > 0) discountMinor = Math.min(discountMinor, capMinor);
  discountMinor = Math.min(discountMinor, eligibleMinor);

  return { discountMinor, couponCode: code, couponError: '' };
}

function emptyLine(line: CartLineInput, quantity: number, issues: string[]): QuotedLine {
  return {
    key: line.key,
    productId: String(line.productId),
    type: 'READY_MADE',
    designId: '',
    name: 'Unavailable design',
    slug: '',
    image: '',
    quantity,
    colorName: '',
    colorSlug: '',
    size: null,
    sku: '',
    fabricId: null,
    fabricName: '',
    fabricMaterial: '',
    fabricColorName: '',
    laceIds: [],
    laceNames: [],
    latkanIds: [],
    latkanNames: [],
    measurementReady: false,
    note: '',
    unitBaseMinor: 0,
    unitFabricMinor: 0,
    unitLaceMinor: 0,
    unitLatkanMinor: 0,
    unitStitchingMinor: 0,
    unitTotalMinor: 0,
    lineTotalMinor: 0,
    issues,
    stockLeft: 0,
  };
}
