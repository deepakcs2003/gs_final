import { Router, type Request, type Response } from 'express';
import { Types, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { Category, Fabric, Lace, Latkan, Product } from '../models/catalog.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, searchLimiter } from '../middleware/rateLimit.js';
import { resolveGeo } from '../services/geo.js';
import { getSettings } from '../services/settings.js';
import { presentProductCard, presentProductDetail } from '../presenters/product.js';
import { cursorFilter, decodeCursor, encodeCursor, type SortDirection } from '../utils/cursor.js';
import { notFound } from '../utils/errors.js';
import { PRODUCT_TYPES } from '../domain/constants.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* Shared query helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Comma-separated facet values arrive as strings. They are split, trimmed,
 * length-capped and matched against a conservative slug pattern before going
 * anywhere near a query — so a value like `{"$ne":null}` can never survive as
 * anything but a harmless string that matches nothing.
 */
const slugList = (max: number) =>
  z
    .string()
    .max(400)
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0 && part.length <= 40 && /^[a-z0-9-]+$/.test(part))
        .slice(0, max),
    );

const SORTS = {
  newest: { field: 'publishedAt', direction: -1 as SortDirection },
  price_asc: { field: 'sellingPriceInr', direction: 1 as SortDirection },
  price_desc: { field: 'sellingPriceInr', direction: -1 as SortDirection },
  popular: { field: 'stats.views', direction: -1 as SortDirection },
  most_viewed: { field: 'stats.views', direction: -1 as SortDirection },
  most_liked: { field: 'stats.wishlists', direction: -1 as SortDirection },
  best_rated: { field: 'rating.average', direction: -1 as SortDirection },
} as const;

const listQuerySchema = z
  .object({
    type: z.enum(PRODUCT_TYPES).optional(),
    category: z
      .string()
      .max(60)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    colors: slugList(12),
    fabrics: slugList(12),
    embroidery: slugList(12),
    tags: slugList(8),
    minPriceInr: z.coerce.number().int().min(0).max(10_000_000).optional(),
    maxPriceInr: z.coerce.number().int().min(0).max(10_000_000).optional(),
    availability: z.enum(['in_stock', 'out_of_stock', 'upcoming']).optional(),
    sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...Array<keyof typeof SORTS>]).default('newest'),
    limit: z.coerce.number().int().min(1).max(40).default(12),
    cursor: z.string().max(512).optional(),
  })
  .strict();

type ListQuery = z.infer<typeof listQuerySchema>;

async function buildProductFilter(query: ListQuery): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = { isActive: true };

  if (query.type === 'READY_MADE' || query.type === 'CUSTOMIZE') {
    // BOTH designs are sold readymade *and* offered as a custom option, so they
    // belong in both storefront sections (pricing resolves the effective type).
    filter.type = { $in: [query.type, 'BOTH'] };
  } else if (query.type) {
    filter.type = query.type;
  }

  if (query.category) {
    const category = await Category.findOne({ slug: query.category, isActive: true }).select('_id').lean();
    // An unknown category must return nothing, not everything.
    filter.category = category?._id ?? new Types.ObjectId('000000000000000000000000');
  }

  if (query.colors.length) filter['colors.slug'] = { $in: query.colors };
  if (query.embroidery.length) filter.embroidery = { $in: query.embroidery };
  if (query.tags.length) filter.tags = { $in: query.tags };

  if (query.fabrics.length) {
    // "Fabric" on a stitched product is descriptive text; on a customisable one
    // it is the set of fabrics offered. Match either.
    const fabricIds = await Fabric.find({ material: { $in: query.fabrics }, isActive: true }).select('_id').lean();
    filter.$or = [
      { fabricOptions: { $in: fabricIds.map((f) => f._id) } },
      { tags: { $in: query.fabrics } },
    ];
  }

  if (query.minPriceInr !== undefined || query.maxPriceInr !== undefined) {
    const range: Record<string, number> = {};
    if (query.minPriceInr !== undefined) range.$gte = query.minPriceInr;
    if (query.maxPriceInr !== undefined) range.$lte = query.maxPriceInr;
    filter.sellingPriceInr = range;
  }

  if (query.availability === 'in_stock') {
    filter.variants = { $elemMatch: { stock: { $gt: 0 } } };
  } else if (query.availability === 'out_of_stock') {
    filter.variants = { $not: { $elemMatch: { stock: { $gt: 0 } } } };
  } else if (query.availability === 'upcoming') {
    filter.$and = [{ $or: [{ type: 'SHOWCASE' }, { comingSoon: true }] }];
  }

  return filter;
}

function sortValueOf(product: Record<string, unknown>, field: string): number | string {
  const value = field.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], product);
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'string') return value;
  return 0;
}

/* -------------------------------------------------------------------------- */
/* GET /api/products                                                           */
/* -------------------------------------------------------------------------- */

router.get('/products', readLimiter, validate({ query: listQuerySchema }), async (req: Request, res: Response) => {
  const query = (req as Request & { validated: { query: ListQuery } }).validated.query;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const { field, direction } = SORTS[query.sort];
  const filter = await buildProductFilter(query);

  const cursor = decodeCursor(query.cursor);
  const finalFilter = cursor ? { $and: [filter, cursorFilter(field, direction, cursor)] } : filter;

  // Fetch one extra row to learn whether another page exists, without a count().
  const docs = await Product.find(finalFilter)
    .sort({ [field]: direction, _id: direction })
    .limit(query.limit + 1)
    .lean();

  const hasMore = docs.length > query.limit;
  const page = hasMore ? docs.slice(0, query.limit) : docs;
  const last = page[page.length - 1];

  res.json({
    items: page.map((doc) => presentProductCard(doc, geo.currency, fxRate)),
    nextCursor: hasMore && last ? encodeCursor(sortValueOf(last, field), last._id) : null,
    currency: geo.currency,
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/products-by-id — bulk lookup for wishlist / recently viewed        */
/* -------------------------------------------------------------------------- */

/**
 * A guest's wishlist and recently-viewed list live in their browser as bare
 * ids. This resolves a batch of them in one request.
 *
 * Deliberately mounted outside `/products/` so it can never be confused with
 * the `/products/:slug` route, and hard-capped at 60 so it cannot be used to
 * dump the catalogue.
 */
const byIdQuerySchema = z
  .object({
    ids: z
      .string()
      .max(1600)
      .optional()
      .transform((raw) =>
        (raw ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter((part) => Types.ObjectId.isValid(part))
          .slice(0, 60),
      ),
    slugs: z
      .string()
      .max(2000)
      .optional()
      .transform((raw) =>
        (raw ?? '')
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter((part) => /^[a-z0-9-]{1,120}$/.test(part))
          .slice(0, 60),
      ),
  })
  .strict();

router.get('/products-by-id', readLimiter, validate({ query: byIdQuerySchema }), async (req: Request, res: Response) => {
  const { ids, slugs } = (req as Request & { validated: { query: z.infer<typeof byIdQuerySchema> } }).validated.query;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  if (ids.length === 0 && slugs.length === 0) {
    res.json({ items: [], currency: geo.currency });
    return;
  }

  const or: Record<string, unknown>[] = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (slugs.length) or.push({ slug: { $in: slugs } });

  const products = await Product.find({ isActive: true, $or: or }).limit(60).lean();

  // Preserve the order the client asked for — a wishlist should read
  // newest-first as the customer saved it, not in database order.
  const order = [...ids, ...slugs];
  const rank = new Map(order.map((value, index) => [value, index]));
  const sorted = products.sort(
    (a, b) =>
      (rank.get(String(a._id)) ?? rank.get(a.slug) ?? 999) - (rank.get(String(b._id)) ?? rank.get(b.slug) ?? 999),
  );

  res.json({
    items: sorted.map((product) => presentProductCard(product, geo.currency, fxRate)),
    currency: geo.currency,
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/products/:slug                                                     */
/* -------------------------------------------------------------------------- */

const slugParams = z.object({ slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/) }).strict();

router.get('/products/:slug', readLimiter, validate({ params: slugParams }), async (req: Request, res: Response) => {
  const { slug } = (req as Request & { validated: { params: { slug: string } } }).validated.params;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const product = await Product.findOne({ slug, isActive: true })
    .populate('category', 'name slug')
    .populate('subCategory', 'name slug')
    .lean();

  if (!product) throw notFound('Yeh design nahi mila.');

  res.json({ product: presentProductDetail(product, geo.currency, fxRate), currency: geo.currency });
});

/* -------------------------------------------------------------------------- */
/* GET /api/products/:slug/similar  (README §68)                               */
/* -------------------------------------------------------------------------- */

router.get(
  '/products/:slug/similar',
  readLimiter,
  validate({ params: slugParams }),
  async (req: Request, res: Response) => {
    const { slug } = (req as Request & { validated: { params: { slug: string } } }).validated.params;
    const geo = resolveGeo(req);
    const settings = await getSettings();
    const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

    const product = await Product.findOne({ slug, isActive: true }).select('category type colors tags _id').lean();
    if (!product) throw notFound('Yeh design nahi mila.');

    const colorSlugs = (product.colors ?? []).map((c) => c.slug);

    // Rank by how much a candidate shares with this design, so "You may also
    // like" is genuinely similar rather than just the newest thing in stock.
    const pipeline: PipelineStage[] = [
      {
        $match: {
          _id: { $ne: product._id },
          isActive: true,
          $or: [
            { category: product.category },
            { 'colors.slug': { $in: colorSlugs } },
            { tags: { $in: product.tags ?? [] } },
          ],
        },
      },
      {
        $addFields: {
          similarity: {
            $add: [
              { $cond: [{ $eq: ['$category', product.category] }, 3, 0] },
              { $cond: [{ $eq: ['$type', product.type] }, 2, 0] },
              { $size: { $setIntersection: ['$tags', product.tags ?? []] } },
            ],
          },
        },
      },
      { $sort: { similarity: -1, 'stats.views': -1, _id: -1 } },
      { $limit: 12 },
    ];

    const docs = await Product.aggregate(pipeline);
    res.json({ items: docs.map((doc) => presentProductCard(doc, geo.currency, fxRate)) });
  },
);

/* -------------------------------------------------------------------------- */
/* GET /api/search  (README §31)                                               */
/* -------------------------------------------------------------------------- */

const searchQuerySchema = z
  .object({
    // Length cap first: it bounds every regex and text scan that follows.
    q: z.string().trim().min(1).max(80),
    type: z.enum(PRODUCT_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(40).default(20),
  })
  .strict();

router.get('/search', searchLimiter, validate({ query: searchQuerySchema }), async (req: Request, res: Response) => {
  const { q, type, limit } = (req as Request & { validated: { query: z.infer<typeof searchQuerySchema> } }).validated
    .query;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const base: Record<string, unknown> = { isActive: true };
  if (type === 'READY_MADE' || type === 'CUSTOMIZE') base.type = { $in: [type, 'BOTH'] };
  else if (type) base.type = type;

  // A design id like "GS-206" or "gs206" should jump straight to that product.
  const designIdGuess = q.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const directMatch = designIdGuess
    ? await Product.findOne({ ...base, designId: designIdGuess }).lean()
    : null;

  const textResults = await Product.find({ ...base, $text: { $search: q } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, 'stats.views': -1 })
    .limit(limit)
    .lean();

  let results = textResults;

  // Text search needs whole words; fall back to a prefix match so "bri" still
  // finds "Bridal". The escape keeps user input out of the regex grammar, and
  // the 80-char cap above bounds the work.
  if (results.length === 0) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    results = await Product.find({
      ...base,
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { designId: { $regex: `^${escaped}`, $options: 'i' } },
        { tags: { $regex: `^${escaped}`, $options: 'i' } },
      ],
    })
      .limit(limit)
      .lean();
  }

  const seen = new Set<string>();
  const merged = [...(directMatch ? [directMatch] : []), ...results].filter((doc) => {
    const id = String(doc._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  res.json({
    query: q,
    items: merged.slice(0, limit).map((doc) => presentProductCard(doc, geo.currency, fxRate)),
    currency: geo.currency,
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/categories                                                         */
/* -------------------------------------------------------------------------- */

const categoryQuerySchema = z.object({ type: z.enum(PRODUCT_TYPES).optional() }).strict();

router.get('/categories', readLimiter, validate({ query: categoryQuerySchema }), async (req: Request, res: Response) => {
  const { type } = (req as Request & { validated: { query: { type?: string } } }).validated.query;

  const filter: Record<string, unknown> = { isActive: true };
  if (type) filter.types = type;

  const categories = await Category.find(filter).sort({ order: 1, name: 1 }).select('name nameHi slug image').lean();

  res.json({
    items: categories.map((c) => ({
      id: String(c._id),
      name: c.name,
      nameHi: c.nameHi ?? '',
      slug: c.slug,
      image: c.image ?? '',
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/home/feed — the infinite-scroll homepage (README §5)               */
/* -------------------------------------------------------------------------- */

const feedQuerySchema = z
  .object({
    // Index into the ordered category list; the feed is a stable sequence of
    // rails, so a plain integer offset is both correct and cheap here.
    offset: z.coerce.number().int().min(0).max(200).default(0),
    perPage: z.coerce.number().int().min(6).max(30).default(12),
  })
  .strict();

router.get('/home/feed', readLimiter, validate({ query: feedQuerySchema }), async (req: Request, res: Response) => {
  const { offset, perPage } = (req as Request & { validated: { query: z.infer<typeof feedQuerySchema> } }).validated
    .query;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const typeOrder = settings.homeFeedOrder.split(',');
  // BOTH designs join whichever of READY_MADE / CUSTOMIZE rails are enabled.
  const expandType = (t: string): string | { $in: string[] } =>
    t === 'READY_MADE' || t === 'CUSTOMIZE' ? { $in: [t, 'BOTH'] } : t;
  const feedTypes = [...new Set(typeOrder.flatMap((t) => (t === 'READY_MADE' || t === 'CUSTOMIZE' ? [t, 'BOTH'] : [t])))];
  const typeFilter = { isActive: true, type: { $in: feedTypes } };
  let products;
  let nextOffset: number | null;

  if (settings.homeFeedMode === 'MIXED') {
    const total = await Product.countDocuments(typeFilter);
    products = await Product.find(typeFilter)
      .sort({ 'stats.views': -1, publishedAt: -1 })
      .skip(offset)
      .limit(settings.homeFeedPageSize)
      .lean();
    nextOffset = offset + products.length < total ? offset + products.length : null;
  } else {
    const counts = await Promise.all(typeOrder.map((type) => Product.countDocuments({ isActive: true, type: expandType(type) })));
    const total = counts.reduce((sum, count) => sum + count, 0);
    let remaining = offset;
    let typeIndex = 0;
    while (typeIndex < typeOrder.length && remaining >= (counts[typeIndex] ?? 0)) {
      remaining -= counts[typeIndex] ?? 0;
      typeIndex += 1;
    }
    products = [];
    let take = settings.homeFeedPageSize;
    while (typeIndex < typeOrder.length && take > 0) {
      const batch = await Product.find({ isActive: true, type: expandType(typeOrder[typeIndex] ?? '') })
        .sort({ 'stats.views': -1, publishedAt: -1 })
        .skip(remaining)
        .limit(take)
        .lean();
      products.push(...batch);
      take -= batch.length;
      typeIndex += 1;
      remaining = 0;
    }
    nextOffset = offset + products.length < total ? offset + products.length : null;
  }

  const grouped = new Map<string, typeof products>();
  for (const product of products) {
    // BOTH designs are buyable now → surface them in the Ready to Buy rail.
    const key = product.type === 'BOTH' ? 'READY_MADE' : product.type;
    const existing = grouped.get(key) ?? [];
    existing.push(product);
    grouped.set(key, existing);
  }
  const titleByType: Record<string, string> = {
    CUSTOMIZE: 'Customize Blouses',
    READY_MADE: 'Ready to Buy',
    SHOWCASE: 'Upcoming Designs',
  };
  const sections = [...grouped.entries()].map(([type, items]) => ({
    id: `home-${type.toLowerCase()}`,
    title: titleByType[type] ?? type,
    titleHi: type === 'CUSTOMIZE' ? 'Apne naap ke designs' : type === 'READY_MADE' ? 'Turant delivery' : 'Jald aa raha hai',
    slug: type === 'CUSTOMIZE' ? 'customize' : type === 'SHOWCASE' ? 'showcase' : 'ready-to-buy',
    items: items.map((product) => presentProductCard(product, geo.currency, fxRate)),
  }));

  res.json({
    sections: sections.filter((section) => section.items.length > 0),
    nextOffset,
    currency: geo.currency,
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/fabrics + /api/laces  (README §14–16)                              */
/* -------------------------------------------------------------------------- */

const fabricQuerySchema = z
  .object({
    colors: slugList(12),
    materials: slugList(12),
    embroidery: slugList(12),
    maxPriceInr: z.coerce.number().int().min(0).max(1_000_000).optional(),
    productId: z
      .string()
      .max(24)
      .refine((v) => Types.ObjectId.isValid(v), 'invalid id')
      .optional(),
    limit: z.coerce.number().int().min(1).max(60).default(40),
  })
  .strict();

router.get('/fabrics', readLimiter, validate({ query: fabricQuerySchema }), async (req: Request, res: Response) => {
  const query = (req as Request & { validated: { query: z.infer<typeof fabricQuerySchema> } }).validated.query;
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const filter: Record<string, unknown> = { isActive: true };
  if (query.colors.length) filter.colorSlug = { $in: query.colors };
  if (query.materials.length) filter.material = { $in: query.materials.map(titleish) };
  if (query.embroidery.length) filter.embroidery = { $in: query.embroidery.map(titleish) };
  if (query.maxPriceInr !== undefined) filter.priceInr = { $lte: query.maxPriceInr };

  // A product may restrict which fabrics it can be stitched from.
  if (query.productId) {
    const product = await Product.findById(query.productId).select('fabricOptions').lean();
    if (product?.fabricOptions?.length) {
      filter._id = { $in: product.fabricOptions };
    }
  }

  const fabrics = await Fabric.find(filter).sort({ order: 1, priceInr: 1 }).limit(query.limit).lean();

  res.json({
    items: fabrics.map((f) => ({
      id: String(f._id),
      name: f.name,
      slug: f.slug,
      material: f.material,
      colorName: f.colorName,
      colorSlug: f.colorSlug,
      colorHex: f.colorHex,
      colors: (f.colors ?? []).map((c) => ({ name: c.name, hex: c.hex })),
      embroidery: f.embroidery ?? [],
      image: f.image ?? '',
      inStock: f.inStock,
      priceMinor: geo.currency === 'INR' ? f.priceInr * 100 : Math.round((f.priceInr / fxRate) * 100),
    })),
    currency: geo.currency,
    facets: await fabricFacets(),
  });
});

router.get('/laces', readLimiter, async (req: Request, res: Response) => {
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const laces = await Lace.find({ isActive: true }).sort({ order: 1, priceInr: 1 }).limit(60).lean();

  res.json({
    items: laces.map((l) => ({
      id: String(l._id),
      name: l.name,
      slug: l.slug,
      colorName: l.colorName ?? '',
      colorHex: l.colorHex ?? '#cccccc',
      colors: (l.colors ?? []).map((c) => ({ name: c.name, hex: c.hex })),
      image: l.image ?? '',
      inStock: l.inStock,
      priceMinor: geo.currency === 'INR' ? l.priceInr * 100 : Math.round((l.priceInr / fxRate) * 100),
    })),
    currency: geo.currency,
  });
});

router.get('/latkans', readLimiter, async (req: Request, res: Response) => {
  const geo = resolveGeo(req);
  const settings = await getSettings();
  const fxRate = geo.currency === 'INR' ? 1 : settings.usdRateInr;

  const latkans = await Latkan.find({ isActive: true }).sort({ order: 1, priceInr: 1 }).limit(60).lean();

  res.json({
    items: latkans.map((l) => ({
      id: String(l._id),
      name: l.name,
      slug: l.slug,
      colorName: l.colorName ?? '',
      colorHex: l.colorHex ?? '#cccccc',
      colors: (l.colors ?? []).map((c) => ({ name: c.name, hex: c.hex })),
      image: l.image ?? '',
      inStock: l.inStock,
      priceMinor: geo.currency === 'INR' ? l.priceInr * 100 : Math.round((l.priceInr / fxRate) * 100),
    })),
    currency: geo.currency,
  });
});

/** Turns a slug back into the stored title-case value ("raw-silk" → "Raw Silk"). */
function titleish(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function fabricFacets() {
  const [materials, colors, embroidery] = await Promise.all([
    Fabric.distinct('material', { isActive: true }),
    Fabric.find({ isActive: true }).select('colorName colorSlug colorHex').lean(),
    Fabric.distinct('embroidery', { isActive: true }),
  ]);

  const colorMap = new Map<string, { name: string; slug: string; hex: string }>();
  for (const c of colors) {
    if (!colorMap.has(c.colorSlug)) {
      colorMap.set(c.colorSlug, { name: c.colorName, slug: c.colorSlug, hex: c.colorHex });
    }
  }

  return {
    materials: materials.filter(Boolean).sort(),
    colors: [...colorMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    embroidery: embroidery.filter(Boolean).sort(),
  };
}

export default router;
