import type { Currency } from '../domain/constants.js';
import { toMinor } from '../services/pricing.js';
import { responsiveUrl } from '../services/media/cloudinary.js';

/**
 * Shapes a product document for the storefront.
 *
 * Two jobs: convert money into the viewer's currency (README §32) and drop
 * anything the browser has no business seeing — internal counters, SKUs and
 * exact stock numbers stay server-side. Only a coarse "low stock" flag is
 * exposed, which is enough for the honest "Only 2 left" badge (§67) without
 * publishing the inventory.
 */

export interface PriceView {
  currency: Currency;
  mrpMinor: number;
  priceMinor: number;
  discountPercent: number;
}

function priceView(mrpInr: number, sellingInr: number, currency: Currency, fxRateInr: number): PriceView {
  return {
    currency,
    mrpMinor: toMinor(mrpInr, currency, fxRateInr),
    priceMinor: toMinor(sellingInr, currency, fxRateInr),
    discountPercent: mrpInr > sellingInr ? Math.round(((mrpInr - sellingInr) / mrpInr) * 100) : 0,
  };
}

/**
 * Structural shape rather than the Mongoose document type: presenters are fed
 * lean documents, aggregation results and populated docs alike. Nullable fields
 * mirror what Mongoose actually hands back for optional subdocuments.
 */
interface ProductLike {
  _id: unknown;
  designId: string;
  slug: string;
  name: string;
  description?: string | null;
  type: string;
  category?: unknown;
  subCategory?: unknown;
  tags?: string[] | null;
  mrpInr: number;
  sellingPriceInr: number;
  codInitialPaymentPercent?: number | null;
  images?: Array<{ url: string; alt?: string | null; kind?: string | null; width?: number | null; height?: number | null }> | null;
  videoUrl?: string | null;
  colors?: Array<{ name: string; slug: string; hex: string }> | null;
  sizes?: number[] | null;
  variants?: Array<{ colorSlug: string; size: number; stock: number }> | null;
  fabricOptions?: unknown[] | null;
  laceOptions?: unknown[] | null;
  latkanOptions?: unknown[] | null;
  minFabricCount?: number | null;
  maxFabricCount?: number | null;
  minLaceCount?: number | null;
  maxLaceCount?: number | null;
  minLatkanCount?: number | null;
  maxLatkanCount?: number | null;
  fabricInfo?: string | null;
  embroidery?: string[] | null;
  careInstructions?: string | null;
  stitchingInfo?: string | null;
  stitchingDays?: number | null;
  expectedAvailability?: string | null;
  comingSoon?: boolean | null;
  rating?: { average?: number | null; count?: number | null } | null;
  stats?: Record<string, number> | null;
  seo?: { title?: string | null; description?: string | null; keywords?: string[] | null; ogImage?: string | null } | null;
  publishedAt?: Date | null;
}

const LOW_STOCK_THRESHOLD = 3;

export function presentProductCard(product: ProductLike, currency: Currency, fxRateInr: number) {
  const totalStock = (product.variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);
  const isReadyMade = product.type === 'READY_MADE' || product.type === 'BOTH';

  return {
    id: String(product._id),
    designId: product.designId,
    slug: product.slug,
    name: product.name,
    type: product.type,
    image: responsiveUrl(product.images?.[0]?.url ?? '', 600),
    imageAlt: product.images?.[0]?.alt ?? product.name,
    hoverImage: responsiveUrl(product.images?.[1]?.url ?? '', 600),
    price: priceView(product.mrpInr, product.sellingPriceInr, currency, fxRateInr),
    codInitialPaymentPercent: product.codInitialPaymentPercent ?? 25,
    colors: (product.colors ?? []).map((c) => ({ name: c.name, slug: c.slug, hex: c.hex })),
    sizes: product.sizes ?? [],
    rating: { average: product.rating?.average ?? 0, count: product.rating?.count ?? 0 },
    comingSoon: Boolean(product.comingSoon),
    expectedAvailability: product.expectedAvailability ?? '',
    inStock: isReadyMade ? totalStock > 0 : true,
    minFabricCount: product.minFabricCount ?? 1,
    maxFabricCount: product.maxFabricCount ?? 1,
    minLaceCount: product.minLaceCount ?? 1,
    maxLaceCount: product.maxLaceCount ?? 1,
    minLatkanCount: product.minLatkanCount ?? 1,
    maxLatkanCount: product.maxLatkanCount ?? 1,
    // Coarse signal only — never the raw inventory count.
    lowStock: isReadyMade && totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD ? totalStock : null,
  };
}

export function presentProductDetail(product: ProductLike, currency: Currency, fxRateInr: number) {
  const card = presentProductCard(product, currency, fxRateInr);

  /**
   * The size × colour availability matrix the PDP needs to grey out
   * combinations (README §11). Booleans only — an exact count per variant would
   * hand competitors a live inventory feed.
   */
  const availability = (product.variants ?? []).map((v) => ({
    colorSlug: v.colorSlug,
    size: v.size,
    available: (v.stock ?? 0) > 0,
    lowStock: (v.stock ?? 0) > 0 && (v.stock ?? 0) <= LOW_STOCK_THRESHOLD ? v.stock : null,
  }));

  return {
    ...card,
    description: product.description ?? '',
    category: product.category ?? null,
    subCategory: product.subCategory ?? null,
    tags: product.tags ?? [],
    images: (product.images ?? []).map((img) => ({
      url: responsiveUrl(img.url, 900),
      alt: img.alt ?? product.name,
      kind: img.kind ?? 'other',
      width: img.width ?? 0,
      height: img.height ?? 0,
    })),
    videoUrl: product.videoUrl ?? '',
    availability,
    fabricOptionIds: (product.fabricOptions ?? []).map(String),
    minFabricCount: product.minFabricCount ?? 1,
    maxFabricCount: product.maxFabricCount ?? 1,
    laceOptionIds: (product.laceOptions ?? []).map(String),
    minLaceCount: product.minLaceCount ?? 1,
    maxLaceCount: product.maxLaceCount ?? 1,
    latkanOptionIds: (product.latkanOptions ?? []).map(String),
    minLatkanCount: product.minLatkanCount ?? 1,
    maxLatkanCount: product.maxLatkanCount ?? 1,
    fabricInfo: product.fabricInfo ?? '',
    embroidery: product.embroidery ?? [],
    careInstructions: product.careInstructions ?? '',
    stitchingInfo: product.stitchingInfo ?? '',
    stitchingDays: product.stitchingDays ?? 7,
    seo: {
      title: product.seo?.title || `${product.name} | Guddi Silai`,
      description: product.seo?.description || (product.description ?? '').slice(0, 160),
      keywords: product.seo?.keywords ?? [],
      ogImage: product.seo?.ogImage || product.images?.[0]?.url || '',
    },
  };
}
