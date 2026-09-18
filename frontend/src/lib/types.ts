import type { Currency } from './format';

export type ProductType = 'READY_MADE' | 'CUSTOMIZE' | 'BOTH' | 'SHOWCASE';

export interface PriceView {
  currency: Currency;
  mrpMinor: number;
  priceMinor: number;
  discountPercent: number;
}

export interface ColorOption {
  name: string;
  slug: string;
  hex: string;
}

export interface ProductCard {
  id: string;
  designId: string;
  slug: string;
  name: string;
  type: ProductType;
  image: string;
  imageAlt: string;
  hoverImage: string;
  price: PriceView;
  codInitialPaymentPercent: number;
  colors: ColorOption[];
  sizes: number[];
  rating: { average: number; count: number };
  comingSoon: boolean;
  expectedAvailability: string;
  inStock: boolean;
  /** Real remaining units when low, else null. Never a fake urgency number. */
  lowStock: number | null;
  minFabricCount: number;
  maxFabricCount: number;
  minLaceCount: number;
  maxLaceCount: number;
  minLatkanCount: number;
  maxLatkanCount: number;
}

export interface ProductImage {
  url: string;
  alt: string;
  kind: string;
  width: number;
  height: number;
}

export interface AvailabilityCell {
  colorSlug: string;
  size: number;
  available: boolean;
  lowStock: number | null;
}

export interface ProductDetail extends ProductCard {
  description: string;
  category: { _id: string; name: string; slug: string } | null;
  subCategory: { _id: string; name: string; slug: string } | null;
  tags: string[];
  images: ProductImage[];
  videoUrl: string;
  availability: AvailabilityCell[];
  fabricOptionIds: string[];
  minFabricCount: number;
  maxFabricCount: number;
  laceOptionIds: string[];
  latkanOptionIds: string[];
  minLaceCount: number;
  maxLaceCount: number;
  minLatkanCount: number;
  maxLatkanCount: number;
  fabricInfo: string;
  embroidery: string[];
  careInstructions: string;
  stitchingInfo: string;
  stitchingDays: number;
  seo: { title: string; description: string; keywords: string[]; ogImage: string };
}

export interface Fabric {
  id: string;
  name: string;
  slug: string;
  material: string;
  colorName: string;
  colorSlug: string;
  colorHex: string;
  colors: Array<{ name: string; hex: string }>;
  embroidery: string[];
  image: string;
  inStock: boolean;
  priceMinor: number;
}

export interface Lace {
  id: string;
  name: string;
  slug: string;
  colorName: string;
  colorHex: string;
  colors: Array<{ name: string; hex: string }>;
  image: string;
  inStock: boolean;
  priceMinor: number;
}

export interface Latkan {
  id: string;
  name: string;
  slug: string;
  colorName: string;
  colorHex: string;
  colors: Array<{ name: string; hex: string }>;
  image: string;
  inStock: boolean;
  priceMinor: number;
}

export interface FabricFacets {
  materials: string[];
  colors: ColorOption[];
  embroidery: string[];
}

export interface Category {
  id: string;
  name: string;
  nameHi: string;
  slug: string;
  image: string;
}

/* -------------------------------------------------------------------------- */
/* Admin-managed storefront content (banners + homepage sections)              */
/* -------------------------------------------------------------------------- */

export type BannerPosition = 'hero' | 'mid' | 'footer';

export interface HomeBanner {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  ctaText: string;
  ctaLink: string;
  offerText: string;
  position: BannerPosition;
  startsAt: string | null;
  expiresAt: string | null;
}

/** Active promotional popup delivered by GET /offer-popup (README §85.14). */
export interface OfferPopup {
  id: string;
  offerType: 'discount' | 'free';
  headline: string;
  limited: boolean;
  startsAt: string | null;
  endsAt: string | null;
  delaySeconds: number;
  product: ProductCard;
}

export interface OfferPopupResponse {
  currency: Currency;
  popup: OfferPopup | null;
}

/** A product inside an admin-picked homepage section (mapped from the API). */
export interface HomeSectionProduct {
  id: string;
  designId: string;
  slug: string;
  name: string;
  type: ProductType;
  image: string;
  mrpMinor: number;
  priceMinor: number;
}

export interface HomepageSection {
  id: string;
  key: string;
  title: string;
  subtitle: string;
  type: string;
  maxProducts: number;
  buttonText: string;
  buttonLink: string;
  productIds: HomeSectionProduct[];
  categoryId: { name: string; slug: string } | null;
}

export interface ProductCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  productIds: string[];
  isActive: boolean;
  order: number;
  productCount?: number;
}

/** Admin-managed content page — README §85.12. */
export interface ManagedPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
}

export interface MeasurementFieldDef {
  key: string;
  label: string;
  labelHi: string;
  instruction: string;
  gifUrl: string;
  imageUrl: string;
  required: boolean;
  min: number;
  max: number;
}

export type MeasurementUnit = 'inch' | 'cm';

export interface MeasurementData {
  unit: MeasurementUnit;
  values: Record<string, number>;
  confirmed: boolean;
}

/** A cart line as the browser stores it: choices only, never prices. */
export interface CartLine {
  key: string;
  productId: string;
  type: ProductType;
  quantity: number;
  colorSlug?: string;
  size?: number | null;
  fabricId?: string | null;
  fabricIds?: string[];
  laceIds?: string[];
  /** Chosen colour per lace, parallel to `laceIds` (display is folded in the quote). */
  laceColors?: Array<{ id: string; colorName: string; colorHex?: string }>;
  latkanIds?: string[];
  /** Chosen colour per latkan, parallel to `latkanIds`. */
  latkanColors?: Array<{ id: string; colorName: string; colorHex?: string }>;
  measurement?: MeasurementData | null;
  note?: string;
  /** Display-only snapshot so the cart renders instantly before the quote lands. */
  snapshot: {
    name: string;
    designId: string;
    slug: string;
    image: string;
    colorName?: string;
    fabricName?: string;
    laceName?: string;
    latkanName?: string;
  };
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
  fabricName: string;
  fabricMaterial: string;
  fabricColorName: string;
  fabricDetails: Array<{ name: string; material: string; colorName: string; image: string }>;
  laceNames: string[];
  laceDetails: Array<{ name: string; colorName: string; image: string }>;
  latkanNames: string[];
  latkanDetails: Array<{ name: string; colorName: string; image: string }>;
  measurementReady: boolean;
  note: string;
  unitTotalMinor: number;
  lineTotalMinor: number;
  issues: string[];
  stockLeft: number | null;
}

export interface AvailableCoupon {
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  valueInr: number;
  minOrderInr: number;
  discountMinor: number;
  restrictedToProducts: boolean;
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
    codAdvanceMinor: number;
    codBalanceMinor: number;
  };
  couponError: string;
  shippingChargedLater: boolean;
  blocking: boolean;
  /** Present only when the cart has a custom-stitched line. */
  deliveryEstimate?: {
    stitchingWorkingDays: number;
    from: string;
    to: string;
  };
}

export interface SiteConfig {
  whatsappNumber: string;
  callNumber: string;
  currency: Currency;
  country: string;
  usdRateInr: number;
  codAllowed: boolean;
  shippingFlatInr: number;
  freeShippingAboveInr: number;
  razorpay: { enabled: boolean; keyId: string };
  googleClientId: string;
  appBaseUrl: string;
  homeFeedMode: 'SEQUENTIAL' | 'MIXED';
  homeFeedOrder: ProductType[];
  homeFeedPageSize: number;
  laceColorPickerEnabled: boolean;
  latkanColorPickerEnabled: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
  mobile: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  addresses: SavedAddress[];
  lastSeenPath: string;
}

export interface SavedAddress {
  _id?: string;
  label: string;
  name: string;
  mobile: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

export interface OrderSummary {
  orderNumber: string;
  currency: Currency;
  status: string;
  statusLabel: string;
  placedAt: string;
  totalMinor: number;
  paymentMethod: string;
  paymentStatus: string;
  itemCount: number;
  items: Array<{
    name: string;
    designId: string;
    slug: string;
    image: string;
    quantity: number;
    type: ProductType;
    colorName: string;
    size: number | null;
    fabricName: string;
    fabricDetails?: Array<{ name: string; material: string; colorName: string; image: string }>;
    laceNames?: string[];
    laceDetails?: Array<{ name: string; colorName: string; image: string }>;
    latkanNames?: string[];
    latkanDetails?: Array<{ name: string; colorName: string; image: string }>;
    lineTotalMinor: number;
  }>;
}

export interface OrderDetail extends OrderSummary {
  amounts: CartQuote['amounts'];
  address: Record<string, string>;
  contact: Record<string, string>;
  customerNote: string;
  timeline: Array<{ status: string; label: string; at: string }>;
  tracking: {
    awb: string;
    courier: string;
    trackingUrl: string;
    estimatedDeliveryAt: string | null;
    status: string;
    statusText: string;
    lastSyncedAt: string | null;
  };
  /** Admin-set confirmed delivery date (tracking par dikhti hai). */
  promisedDeliveryAt: string | null;
  deliveryEstimate: {
    stitchingWorkingDays: number;
    from: string;
    to: string;
  } | null;
}

export interface Review {
  id: string;
  name: string;
  rating: number;
  text: string;
  photos: string[];
  verifiedPurchase: boolean;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  currency: Currency;
}
