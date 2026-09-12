import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, ArrowUpDown, PackageSearch } from 'lucide-react';
import clsx from 'clsx';
import { ProductCardView } from '../components/product/ProductCard';
import { InfiniteSentinel } from '../components/InfiniteSentinel';
import { EmptyState, Sheet } from '../components/ui';
import { SectionTabs } from '../components/layout/SectionTabs';
import { ProductGridSkeleton } from './Home';
import { useCategories, useConfig, useFabrics, useProducts, type ProductFilters } from '../hooks/queries';
import { formatMoney } from '../lib/format';
import type { ProductType } from '../lib/types';

/**
 * Section listing (README §32–33).
 *
 * Filters live in a bottom sheet on phones and a sidebar on desktop, so the
 * grid keeps the full width where screens are small.
 */

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'most_liked', label: 'Most Liked' },
  { value: 'most_viewed', label: 'Most Viewed' },
  { value: 'best_rated', label: 'Best Rated' },
];

/** Buckets are defined in rupees; foreign viewers see them converted. */
const PRICE_BUCKETS = [
  { min: 0, max: 500 },
  { min: 500, max: 1000 },
  { min: 1000, max: 2000 },
  { min: 2000, max: undefined },
];

const AVAILABILITY = [
  { value: 'in_stock', label: 'In Stock' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'upcoming', label: 'Upcoming' },
];

const TITLES: Record<ProductType, { title: string; subtitle: string }> = {
  READY_MADE: { title: 'Ready to Buy', subtitle: 'Silai kiye hue blouse — turant order karein' },
  CUSTOMIZE: { title: 'Customize with Measurement', subtitle: 'Fabric choose karein, apna naap dein' },
  BOTH: { title: 'Ready to Buy + Customize', subtitle: 'Turant lein ya apni pasand ke hisaab se banwayein' },
  SHOWCASE: { title: 'New & Upcoming Designs', subtitle: 'Aane wale designs — pasand aaye to WhatsApp karein' },
};

export function ListingPage({ type }: { type: ProductType }) {
  const { category } = useParams<{ category?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: config } = useConfig();
  const { data: categories } = useCategories(type);
  const { data: fabricData } = useFabrics({});

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const currency = config?.currency ?? 'INR';
  const usdRate = config?.usdRateInr ?? 88;

  const sort = searchParams.get('sort') ?? 'newest';
  const colors = searchParams.get('colors')?.split(',').filter(Boolean) ?? [];
  const fabrics = searchParams.get('fabrics')?.split(',').filter(Boolean) ?? [];
  const embroidery = searchParams.get('embroidery')?.split(',').filter(Boolean) ?? [];
  const availability = searchParams.get('availability') ?? '';
  const minPriceInr = searchParams.get('minPriceInr');
  const maxPriceInr = searchParams.get('maxPriceInr');

  const filters: ProductFilters = useMemo(
    () => ({
      type,
      ...(category ? { category } : {}),
      ...(colors.length ? { colors } : {}),
      ...(fabrics.length ? { fabrics } : {}),
      ...(embroidery.length ? { embroidery } : {}),
      ...(availability ? { availability } : {}),
      ...(minPriceInr ? { minPriceInr: Number(minPriceInr) } : {}),
      ...(maxPriceInr ? { maxPriceInr: Number(maxPriceInr) } : {}),
      sort,
    }),
    [type, category, searchParams.toString()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const query = useProducts(filters, 12);
  const products = query.data?.pages.flatMap((page) => page.items) ?? [];

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const toggleParam = (key: string, value: string) => {
    const current = searchParams.get(key)?.split(',').filter(Boolean) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setParam(key, next.length ? next.join(',') : null);
  };

  const activeCount =
    colors.length + fabrics.length + embroidery.length + (availability ? 1 : 0) + (minPriceInr || maxPriceInr ? 1 : 0);

  const clearAll = () => setSearchParams(sort !== 'newest' ? new URLSearchParams({ sort }) : new URLSearchParams());

  const facets = fabricData?.facets;

  const filterPanel = (
    <div className="space-y-5">
      <FacetGroup title="Price">
        <div className="flex flex-wrap gap-2">
          {PRICE_BUCKETS.map((bucket) => {
            const isActive = minPriceInr === String(bucket.min) && (maxPriceInr ?? '') === String(bucket.max ?? '');
            const label =
              currency === 'INR'
                ? bucket.max
                  ? `₹${bucket.min} – ₹${bucket.max}`
                  : `₹${bucket.min}+`
                : bucket.max
                  ? `${formatMoney(Math.round((bucket.min / usdRate) * 100), 'USD')} – ${formatMoney(Math.round((bucket.max / usdRate) * 100), 'USD')}`
                  : `${formatMoney(Math.round((bucket.min / usdRate) * 100), 'USD')}+`;

            return (
              <button
                key={`${bucket.min}-${bucket.max}`}
                type="button"
                className={clsx('chip', isActive && 'chip-active')}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  if (isActive) {
                    next.delete('minPriceInr');
                    next.delete('maxPriceInr');
                  } else {
                    next.set('minPriceInr', String(bucket.min));
                    if (bucket.max) next.set('maxPriceInr', String(bucket.max));
                    else next.delete('maxPriceInr');
                  }
                  setSearchParams(next, { replace: true });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </FacetGroup>

      {facets ? (
        <>
          <FacetGroup title="Color">
            <div className="flex flex-wrap gap-2">
              {facets.colors.map((color) => (
                <button
                  key={color.slug}
                  type="button"
                  className={clsx('chip', colors.includes(color.slug) && 'chip-active')}
                  onClick={() => toggleParam('colors', color.slug)}
                >
                  <span className="h-3.5 w-3.5 rounded-full border border-ink-light/40" style={{ backgroundColor: color.hex }} />
                  {color.name}
                </button>
              ))}
            </div>
          </FacetGroup>

          <FacetGroup title="Fabric">
            <div className="flex flex-wrap gap-2">
              {facets.materials.map((material) => {
                const value = material.toLowerCase().replace(/\s+/g, '-');
                return (
                  <button
                    key={material}
                    type="button"
                    className={clsx('chip', fabrics.includes(value) && 'chip-active')}
                    onClick={() => toggleParam('fabrics', value)}
                  >
                    {material}
                  </button>
                );
              })}
            </div>
          </FacetGroup>

          <FacetGroup title="Embroidery">
            <div className="flex flex-wrap gap-2">
              {facets.embroidery.map((item) => {
                const value = item.toLowerCase().replace(/\s+/g, '-');
                return (
                  <button
                    key={item}
                    type="button"
                    className={clsx('chip', embroidery.includes(value) && 'chip-active')}
                    onClick={() => toggleParam('embroidery', value)}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </FacetGroup>
        </>
      ) : null}

      <FacetGroup title="Availability">
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx('chip', availability === option.value && 'chip-active')}
              onClick={() => setParam('availability', availability === option.value ? null : option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </FacetGroup>
    </div>
  );

  const sectionBase = type === 'READY_MADE' ? '/ready-to-buy' : type === 'CUSTOMIZE' ? '/customize' : '/showcase';

  return (
    <>
      {/* Always-visible section switcher, pinned under the header */}
      <SectionTabs />

      <div className="mx-auto max-w-7xl px-3 sm:px-5">
      <header className="mb-3 pt-3">
        <h1 className="section-title">{TITLES[type].title}</h1>
        <p className="hint">{TITLES[type].subtitle}</p>
      </header>

      {/* Category chips */}
      {categories && categories.length > 0 ? (
        <div className="rail mb-3">
          <Link to={sectionBase} className={clsx('chip shrink-0', !category && 'chip-active')}>
            All
          </Link>
          {categories.map((item) => (
            <Link
              key={item.id}
              to={`${sectionBase}/${item.slug}`}
              className={clsx('chip shrink-0', category === item.slug && 'chip-active')}
            >
              {item.name}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Filter + sort bar — sticks below the section tabs */}
      <div className="sticky top-[calc(var(--header-h)+var(--tabs-h))] z-20 -mx-3 mb-4 flex items-center gap-2 border-b border-maroon-100 bg-cream/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:hidden">
        <button type="button" onClick={() => setFiltersOpen(true)} className={clsx('chip flex-1', activeCount > 0 && 'chip-active')}>
          <SlidersHorizontal size={16} />
          Filter{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        <button type="button" onClick={() => setSortOpen(true)} className="chip flex-1">
          <ArrowUpDown size={16} />
          {SORTS.find((s) => s.value === sort)?.label ?? 'Sort'}
        </button>
      </div>

      <div className="lg:flex lg:gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-[calc(var(--header-h)+var(--tabs-h)+16px)] rounded-xl2 bg-white p-4 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Filters</h2>
              {activeCount > 0 ? (
                <button type="button" onClick={clearAll} className="text-[13px] font-semibold text-maroon-700 underline">
                  Clear
                </button>
              ) : null}
            </div>
            {filterPanel}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-3 hidden items-center justify-between lg:flex">
            <p className="text-sm text-ink-muted">{products.length} designs</p>
            <select
              value={sort}
              onChange={(event) => setParam('sort', event.target.value)}
              className="field h-11 w-56"
              aria-label="Sort"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {query.isLoading ? (
            <ProductGridSkeleton count={8} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<PackageSearch size={30} />}
              title="Koi design nahi mila"
              message="Filter thoda kam karke dekhein, ya doosri category try karein."
              action={
                activeCount > 0 ? (
                  <button type="button" onClick={clearAll} className="btn-primary">
                    Filter hatayein
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((product, index) => (
                <ProductCardView key={product.id} product={product} currency={currency} eager={index < 4} />
              ))}
            </div>
          )}

          <InfiniteSentinel
            onVisible={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
            disabled={!query.hasNextPage}
            loading={query.isFetchingNextPage}
          />
        </div>
      </div>

      {/* Mobile filter sheet */}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={clearAll} className="btn-outline flex-1">
              Clear
            </button>
            <button type="button" onClick={() => setFiltersOpen(false)} className="btn-primary flex-[2]">
              {products.length} designs dekhein
            </button>
          </div>
        }
      >
        <div className="py-1">{filterPanel}</div>
      </Sheet>

      {/* Mobile sort sheet */}
      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort karein">
        <ul className="py-1">
          {SORTS.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => {
                  setParam('sort', option.value);
                  setSortOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-[15px] font-semibold transition',
                  sort === option.value ? 'bg-maroon-50 text-maroon-700' : 'hover:bg-maroon-50',
                )}
              >
                {option.label}
                {sort === option.value ? <span className="text-maroon-600">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      </div>
    </>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </div>
  );
}
