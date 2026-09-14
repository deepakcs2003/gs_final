import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithRefresh, ApiError } from '../lib/api';
import type { Currency } from '../lib/format';
import type {
  AvailableCoupon,
  CartQuote,
  Category,
  CurrentUser,
  Fabric,
  FabricFacets,
  HomeBanner,
  HomepageSection,
  Lace,
  Latkan,
  ManagedPage,
  MeasurementFieldDef,
  MeasurementUnit,
  OrderDetail,
  OrderSummary,
  OfferPopupResponse,
  Paged,
  ProductCard,
  ProductDetail,
  ProductType,
  Review,
  SiteConfig,
} from '../lib/types';
import { buyModeLines, toApiLines, useCart } from '../store/cart';
import type { PublicCoupon } from '../lib/coupons';

/* -------------------------------------------------------------------------- */
/* Site config + session                                                       */
/* -------------------------------------------------------------------------- */

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<SiteConfig>('/config'),
    // Currency and contact numbers change rarely; don't refetch on every mount.
    staleTime: 10 * 60 * 1000,
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await apiWithRefresh<{ user: CurrentUser }>('/auth/me');
      } catch (err) {
        // Signed-out is the normal state on this site, not an error.
        if (err instanceof ApiError && err.status === 401) return { user: null };
        throw err;
      }
    },
    select: (data) => data.user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export interface ProductFilters {
  type?: string;
  category?: string;
  colors?: string[];
  fabrics?: string[];
  embroidery?: string[];
  minPriceInr?: number;
  maxPriceInr?: number;
  availability?: string;
  sort?: string;
}

function filtersToParams(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.category) params.set('category', filters.category);
  if (filters.colors?.length) params.set('colors', filters.colors.join(','));
  if (filters.fabrics?.length) params.set('fabrics', filters.fabrics.join(','));
  if (filters.embroidery?.length) params.set('embroidery', filters.embroidery.join(','));
  if (filters.minPriceInr !== undefined) params.set('minPriceInr', String(filters.minPriceInr));
  if (filters.maxPriceInr !== undefined) params.set('maxPriceInr', String(filters.maxPriceInr));
  if (filters.availability) params.set('availability', filters.availability);
  if (filters.sort) params.set('sort', filters.sort);
  return params;
}

/** Cursor-paginated product list — the engine behind every infinite scroll. */
export function useProducts(filters: ProductFilters, limit = 12) {
  return useInfiniteQuery({
    queryKey: ['products', filters, limit],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = filtersToParams(filters);
      params.set('limit', String(limit));
      if (pageParam) params.set('cursor', pageParam);
      return api<Paged<ProductCard>>(`/products?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60 * 1000,
  });
}

export interface HomeSection {
  id: string;
  title: string;
  titleHi: string;
  slug: string;
  items: ProductCard[];
}

export function useHomeFeed() {
  const { data: config } = useConfig();
  const pageSize = config?.homeFeedPageSize ?? 12;
  return useInfiniteQuery({
    queryKey: ['home-feed', pageSize, config?.homeFeedMode, config?.homeFeedOrder],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ sections: HomeSection[]; nextOffset: number | null }>(`/home/feed?offset=${pageParam}&perPage=${pageSize}`),
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    staleTime: 2 * 60 * 1000,
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => api<{ product: ProductDetail }>(`/products/${slug}`),
    select: (data) => data.product,
    enabled: Boolean(slug),
    staleTime: 60 * 1000,
  });
}

export function useSimilarProducts(slug: string | undefined) {
  return useQuery({
    queryKey: ['similar', slug],
    queryFn: () => api<{ items: ProductCard[] }>(`/products/${slug}/similar`),
    select: (data) => data.items,
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
  });
}

/** Resolves a batch of ids or slugs — wishlist and recently-viewed use this. */
export function useProductsByRef({ ids, slugs }: { ids?: string[]; slugs?: string[] }) {
  const idList = ids?.filter(Boolean) ?? [];
  const slugList = slugs?.filter(Boolean) ?? [];

  return useQuery({
    queryKey: ['products-by-ref', idList, slugList],
    queryFn: () => {
      const params = new URLSearchParams();
      if (idList.length) params.set('ids', idList.slice(0, 60).join(','));
      if (slugList.length) params.set('slugs', slugList.slice(0, 60).join(','));
      return api<{ items: ProductCard[] }>(`/products-by-id?${params.toString()}`);
    },
    select: (data) => data.items,
    enabled: idList.length > 0 || slugList.length > 0,
    staleTime: 60 * 1000,
  });
}

export function useCategories(type?: string) {
  return useQuery({
    queryKey: ['categories', type],
    queryFn: () => api<{ items: Category[] }>(`/categories${type ? `?type=${type}` : ''}`),
    select: (data) => data.items,
    staleTime: 10 * 60 * 1000,
  });
}

/* -------------------------------------------------------------------------- */
/* Admin-managed homepage content (README §85.10–85.13)                        */
/* -------------------------------------------------------------------------- */

export function useBanners() {
  return useQuery({
    queryKey: ['banners'],
    queryFn: () => api<{ items: HomeBanner[] }>('/banners'),
    select: (data) => data.items,
    // Banners change through the admin panel — keep them fresh (the admin
    // invalidates this query on save, and we refetch on tab focus too).
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Active promo popup (README §85.14). Fresh on every mount so a newly
 *  published popup is never picked up from a long-dead cache. */
export function useOfferPopup() {
  return useQuery({
    queryKey: ['offer-popup'],
    queryFn: () => api<OfferPopupResponse>('/offer-popup'),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

interface RawSectionProduct {
  _id: string;
  designId: string;
  slug: string;
  name: string;
  type: ProductType;
  images: { url: string }[];
  mrpInr: number;
  sellingPriceInr: number;
}

interface RawHomepageSection {
  _id: string;
  key: string;
  title: string;
  subtitle: string;
  type: string;
  maxProducts: number;
  buttonText: string;
  buttonLink: string;
  productIds: RawSectionProduct[];
  categoryId: { name: string; slug: string } | null;
}

/**
 * Fetches the admin-ordered homepage sections and adapts the populated
 * product documents (whole rupees, image sub-docs) into card-shaped views
 * (minor units, single image) the storefront can render directly.
 */
export function useHomeSections() {
  return useQuery({
    queryKey: ['home-sections'],
    queryFn: () =>
      api<{ items: RawHomepageSection[] }>('/homepage-sections').then((data) =>
        data.items.map<HomepageSection>((section) => ({
          id: section._id,
          key: section.key,
          title: section.title,
          subtitle: section.subtitle,
          type: section.type,
          maxProducts: section.maxProducts,
          buttonText: section.buttonText,
          buttonLink: section.buttonLink,
          categoryId: section.categoryId,
          productIds: section.productIds.map((p) => ({
            id: p._id,
            designId: p.designId,
            slug: p.slug,
            name: p.name,
            type: p.type,
            image: p.images[0]?.url ?? '',
            mrpMinor: p.mrpInr * 100,
            priceMinor: p.sellingPriceInr * 100,
          })),
        })),
      ),
    staleTime: 5 * 60 * 1000,
  });
}

/** Admin-managed content page (`/page/:slug`) — README §85.12. */
export function usePage(slug: string | undefined) {
  return useQuery({
    queryKey: ['page', slug],
    queryFn: () => api<{ page: ManagedPage }>(`/pages/${encodeURIComponent(slug ?? '')}`),
    select: (data) => data.page,
    enabled: Boolean(slug),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => api<{ items: ProductCard[] }>(`/search?q=${encodeURIComponent(query)}`),
    select: (data) => data.items,
    enabled: enabled && query.trim().length >= 2,
    staleTime: 30 * 1000,
  });
}

export function useReviews(productId: string | undefined) {
  return useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => api<{ items: Review[] }>(`/reviews/${productId}`),
    select: (data) => data.items,
    enabled: Boolean(productId),
    staleTime: 5 * 60 * 1000,
  });
}

/* -------------------------------------------------------------------------- */
/* Fabrics + laces                                                             */
/* -------------------------------------------------------------------------- */

export interface FabricFilters {
  colors?: string[];
  materials?: string[];
  embroidery?: string[];
  maxPriceInr?: number;
  productId?: string;
}

export function useFabrics(filters: FabricFilters, enabled = true) {
  return useQuery({
    queryKey: ['fabrics', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.colors?.length) params.set('colors', filters.colors.join(','));
      if (filters.materials?.length) params.set('materials', filters.materials.join(','));
      if (filters.embroidery?.length) params.set('embroidery', filters.embroidery.join(','));
      if (filters.maxPriceInr !== undefined) params.set('maxPriceInr', String(filters.maxPriceInr));
      if (filters.productId) params.set('productId', filters.productId);
      return api<{ items: Fabric[]; facets: FabricFacets }>(`/fabrics?${params.toString()}`);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLaces(enabled = true) {
  return useQuery({
    queryKey: ['laces'],
    queryFn: () => api<{ items: Lace[] }>('/laces'),
    select: (data) => data.items,
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function useLatkans(enabled = true) {
  return useQuery({
    queryKey: ['latkans'],
    queryFn: () => api<{ items: Latkan[] }>('/latkans'),
    select: (data) => data.items,
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

/* -------------------------------------------------------------------------- */
/* Measurements                                                                */
/* -------------------------------------------------------------------------- */

export function useMeasurementFields(unit: MeasurementUnit) {
  return useQuery({
    queryKey: ['measurement-fields', unit],
    queryFn: () =>
      api<{ unit: MeasurementUnit; instructionVersion: string; fields: MeasurementFieldDef[] }>(
        `/measurements/fields?unit=${unit}`,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

export interface SavedMeasurementProfile {
  id: string;
  name: string;
  isDefault: boolean;
  unit: MeasurementUnit;
  values: Record<string, number>;
  updatedAt: string;
}

export function useMeasurementProfiles(unit: MeasurementUnit, enabled: boolean) {
  return useQuery({
    queryKey: ['measurement-profiles', unit],
    queryFn: () => apiWithRefresh<{ items: SavedMeasurementProfile[] }>(`/measurements/profiles?unit=${unit}`),
    select: (data) => data.items,
    enabled,
    retry: false,
  });
}

export function useSaveMeasurementProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; unit: MeasurementUnit; values: Record<string, number>; isDefault: boolean }) =>
      apiWithRefresh<{ id: string }>('/measurements/profiles', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['measurement-profiles'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Cart quote                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Re-prices the cart whenever its contents or the coupon change. This is the
 * only source of totals anywhere in the UI — the browser never adds prices up
 * on its own.
 */
export function useCartQuote(couponCode: string) {
  const lines = useCart((state) => state.lines);
  const buyKeys = useCart((state) => state.buyKeys);
  const activeLines = useMemo(() => buyModeLines(lines, buyKeys), [lines, buyKeys]);

  return useQuery({
    queryKey: ['cart-quote', activeLines, couponCode],
    queryFn: () =>
      api<CartQuote>('/cart/quote', {
        method: 'POST',
        body: { lines: toApiLines(activeLines), ...(couponCode ? { couponCode } : {}) },
      }),
    enabled: activeLines.length > 0,
    staleTime: 0,
  });
}

/**
 * Coupons the current cart already qualifies for, with estimated discounts.
 * Separate from the quote so the list stays visible even while a coupon is
 * being applied/rejected.
 */
export function useAvailableCoupons() {
  const lines = useCart((state) => state.lines);
  const buyKeys = useCart((state) => state.buyKeys);
  const activeLines = useMemo(() => buyModeLines(lines, buyKeys), [lines, buyKeys]);

  return useQuery({
    queryKey: ['cart-coupons-available', activeLines],
    queryFn: () =>
      api<{ items: AvailableCoupon[]; currency: Currency }>('/cart/coupons/available', {
        method: 'POST',
        body: { lines: toApiLines(activeLines) },
      }),
    enabled: activeLines.length > 0,
    staleTime: 0,
    retry: 1,
  });
}

export function useProductCouponOffers(productIds: string[]) {
  const ids = useMemo(() => [...new Set((productIds ?? []).filter(Boolean))], [productIds]);

  return useQuery({
    queryKey: ['product-coupons', ids],
    queryFn: () =>
      api<{ items: PublicCoupon[] }>(`/coupons/public?${new URLSearchParams({ productIds: ids.join(',') }).toString()}`),
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export function useMyOrders(enabled: boolean) {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => apiWithRefresh<{ items: OrderSummary[] }>('/orders'),
    select: (data) => data.items,
    enabled,
    retry: false,
  });
}

export function useOrder(orderNumber: string | undefined, mobile?: string) {
  return useQuery({
    queryKey: ['order', orderNumber, mobile],
    queryFn: () =>
      apiWithRefresh<{ order: OrderDetail }>(
        `/orders/${orderNumber}${mobile ? `?mobile=${encodeURIComponent(mobile)}` : ''}`,
      ),
    select: (data) => data.order,
    enabled: Boolean(orderNumber),
    retry: false,
  });
}

export interface PincodeCheck {
  pincode: string;
  valid: boolean;
  city: string;
  district: string;
  state: string;
  areas: string[];
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays: number | null;
  courier: string;
  shippingChargeInr: number;
  estimatedDeliveryText: string;
}

export function usePincodeCheck() {
  return useMutation({
    mutationFn: (pincode: string) => api<PincodeCheck>(`/shipping/pincode/${pincode}`),
  });
}
