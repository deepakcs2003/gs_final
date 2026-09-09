import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Badge, Price } from '../ui';
import { SmartImage } from '../SmartImage';
import { useBanners, useConfig, useHomeSections } from '../../hooks/queries';
import type { HomeBanner, BannerPosition, HomeSectionProduct, HomepageSection } from '../../lib/types';
import type { Currency } from '../../lib/format';

/**
 * The admin-managed part of the homepage (README §85.10–85.13).
 *
 * Banners and sections are plain screenshots of the admin content — the order,
 * products and copy are all decided in the admin panel, never in this file.
 * Reading the endpoints for these on the client means a marketing change needs
 * no redeploy.
 */

const TYPE_LISTING: Record<string, string> = {
  READY_MADE: '/ready-to-buy',
  CUSTOMIZE: '/customize',
  SHOWCASE: '/showcase',
  TRENDING: '/ready-to-buy?sort=popular',
  NEW: '/showcase',
  FEATURED: '/ready-to-buy?sort=popular',
  CUSTOM: '/',
};

/* -------------------------------------------------------------------------- */
/* Banners                                                                     */
/* -------------------------------------------------------------------------- */

export function HomeBannerRail({ position, className }: { position: BannerPosition; className?: string }) {
  const { data } = useBanners();
  const banners = (data ?? []).filter((banner) => banner.position === position);
  if (!banners.length) return null;

  // Real-ecommerce distribution without duplicating a banner: hero leads with
  // a single feature (or a carousel when several hero banners are active), mid
  // becomes a 2-up grid, footer stacks full-width.
  return (
    <section className={clsx(className)} aria-label="Promo banners">
      {position === 'hero' ? (
        banners.length > 1 ? (
          <HeroBannerCarousel banners={banners} />
        ) : (
          <HomeBannerCard banner={banners[0]} tall />
        )
      ) : position === 'mid' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {banners.map((banner) => (
            <HomeBannerCard key={banner.id} banner={banner} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {banners.map((banner) => (
            <HomeBannerCard key={banner.id} banner={banner} tall />
          ))}
        </div>
      )}
    </section>
  );
}

/** Auto-advancing hero carousel for multiple active hero banners. */
function HeroBannerCarousel({ banners }: { banners: HomeBanner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (banners.length < 2 || paused) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % banners.length), 5500);
    return () => window.clearInterval(timer);
  }, [banners.length, paused]);

  const current = banners[Math.min(index, banners.length - 1)];

  return (
    <div className="group" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative">
        <HomeBannerCard banner={current} tall />
        <button
          type="button"
          aria-label="Pehla banner"
          onClick={() => setIndex((index - 1 + banners.length) % banners.length)}
          className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur transition hover:bg-white/40 group-hover:opacity-100 sm:grid"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          aria-label="Agla banner"
          onClick={() => setIndex((index + 1) % banners.length)}
          className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur transition hover:bg-white/40 group-hover:opacity-100 sm:grid"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="flex justify-center gap-1.5 pt-2">
        {banners.map((banner, i) => (
          <button
            key={banner.id}
            type="button"
            aria-label={`Banner ${i + 1}`}
            onClick={() => setIndex(i)}
            className={clsx('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-marigold-500' : 'w-2 bg-ink/20 hover:bg-ink/40')}
          />
        ))}
      </div>
    </div>
  );
}

function HomeBannerCard({ banner, tall }: { banner: HomeBanner; tall?: boolean }) {
  const card = (
    <div
      className={clsx(
        'group relative w-full overflow-hidden rounded-xl2 shadow-card',
        tall ? 'h-48 sm:h-60 md:h-72' : 'h-40 sm:h-52',
      )}
    >
      {banner.image ? (
        <SmartImage
          src={banner.image}
          alt={banner.title}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : (
        <span className="absolute inset-0 bg-gradient-to-br from-maroon-700 via-maroon-800 to-maroon-950" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/5" />
      <span className="absolute inset-0 flex items-end p-5 sm:p-7">
        <span className="max-w-md">
          {banner.offerText ? (
            <span className="mb-2.5 inline-block -rotate-1 rounded-lg bg-marigold-400 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-ink shadow-lift sm:text-xs">
              {banner.offerText}
            </span>
          ) : null}
          <span className="block font-display text-lg font-bold leading-tight text-white drop-shadow-sm sm:text-2xl">
            {banner.title}
          </span>
          {banner.subtitle ? (
            <span className="mt-1.5 block text-[13px] text-white/90 sm:text-[15px]">{banner.subtitle}</span>
          ) : null}
          {banner.ctaText ? (
            <span className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-maroon-700 shadow-lift transition-all group-hover:gap-2.5 group-hover:bg-marigold-400">
              {banner.ctaText}
              <ArrowRight size={15} />
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );

  if (!banner.ctaLink) return card;

  // Internal links stay in-app; anything else (payment links, Instagram…)
  // opens in a new tab.
  if (banner.ctaLink.startsWith('http')) {
    return (
      <a href={banner.ctaLink} target="_blank" rel="noopener noreferrer" className="block">
        {card}
      </a>
    );
  }
  return <Link to={banner.ctaLink} className="block">{card}</Link>;
}

/* -------------------------------------------------------------------------- */
/* Homepage sections                                                           */
/* -------------------------------------------------------------------------- */

export function HomeManagerSections() {
  const { data: config } = useConfig();
  const { data: sections } = useHomeSections();
  const currency = config?.currency ?? 'INR';

  if (!sections || sections.length === 0) return null;

  return (
    <>
      {sections.map((section, index) => (
        <HomeSectionView key={section.key} section={section} currency={currency} eager={index < 2} />
      ))}
    </>
  );
}

function HomeSectionView({
  section,
  currency,
  eager,
}: {
  section: HomepageSection;
  currency: Currency;
  eager?: boolean;
}) {
  const products = section.productIds.slice(0, section.maxProducts);
  const onlyCategory = products.length === 0 && section.categoryId;
  if (products.length === 0 && !onlyCategory) return null;

  const listing = TYPE_LISTING[section.type] ?? '/';
  const viewAllTo =
    section.buttonLink && section.buttonLink !== '/'
      ? section.buttonLink
      : section.categoryId
        ? `${listing}/${section.categoryId.slug}`
        : listing === '/'
          ? null
          : listing;
  const actionLabel = section.buttonText === 'View All' ? 'Sab dekhein' : section.buttonText;

  return (
    <section className="pt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title truncate">{section.title}</h2>
          {section.subtitle ? <p className="hint truncate">{section.subtitle}</p> : null}
        </div>
        {viewAllTo ? (
          <Link
            to={viewAllTo}
            className="flex shrink-0 items-center gap-1 text-[13px] font-bold text-maroon-700 hover:underline"
          >
            {actionLabel}
            <ArrowRight size={15} />
          </Link>
        ) : null}
      </div>

      {products.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {products.map((product) => (
            <SectionProductTile key={product.id} product={product} currency={currency} eager={eager} />
          ))}
        </div>
      ) : (
        <Link to={viewAllTo ?? '/'} className="card flex items-center justify-between gap-3 p-4">
          <span className="text-[15px] font-bold text-ink">{section.categoryId?.name}</span>
          <span className="flex items-center gap-1 text-[13px] font-bold text-maroon-700">
            {actionLabel}
            <ArrowRight size={15} />
          </span>
        </Link>
      )}
    </section>
  );
}

function SectionProductTile({
  product,
  currency,
  eager,
}: {
  product: HomeSectionProduct;
  currency: Currency;
  eager?: boolean;
}) {
  const discountPercent =
    product.mrpMinor > product.priceMinor ? Math.round(((product.mrpMinor - product.priceMinor) / product.mrpMinor) * 100) : 0;

  return (
    <Link to={`/blouse/${product.slug}`} className="group card flex flex-col overflow-hidden">
      <div className="relative aspect-[3/4] overflow-hidden bg-maroon-50">
        {product.image ? (
          <SmartImage
            src={product.image}
            alt={product.name}
            eager={eager}
            sizes="(max-width: 640px) 50vw, 25vw"
            className="transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="grid h-full place-items-center text-[11px] text-ink-muted">{product.designId}</span>
        )}
        <span className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1.5">
          {product.type === 'SHOWCASE' ? <Badge tone="dark">Showcase</Badge> : null}
          {product.type === 'CUSTOMIZE' ? <Badge tone="accent">Customize</Badge> : null}
          {discountPercent > 0 ? <Badge>{discountPercent}% OFF</Badge> : null}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink">{product.name}</h3>
        {product.type === 'SHOWCASE' ? (
          <p className="hint">Jald aa raha hai</p>
        ) : (
          <Price
            price={{ priceMinor: product.priceMinor, mrpMinor: product.mrpMinor, discountPercent }}
            currency={currency}
            size="sm"
          />
        )}
      </div>
    </Link>
  );
}