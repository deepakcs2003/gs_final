import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Badge, Price } from '../ui';
import { SmartImage } from '../SmartImage';
import { useBanners, useConfig, useHomeSections, useProductCouponOffers } from '../../hooks/queries';
import { getBestCouponForProduct } from '../../lib/coupons';
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
  const offerMatch = banner.offerText.match(/(\d{1,3})\s*%/);
  const offerPercent = offerMatch ? `${offerMatch[1]}% OFF` : banner.offerText;
  const card = (
    <div
      className={clsx(
        'group relative w-full overflow-hidden rounded-xl2 bg-ink shadow-card',
        tall ? 'aspect-[4/3] sm:aspect-[2.8/1]' : 'aspect-[4/3] sm:aspect-[2.4/1]',
      )}
    >
      {banner.image ? (
        <SmartImage
          src={banner.image}
          alt={banner.title}
          className="absolute inset-0 h-full w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
        />
      ) : (
        <span className="absolute inset-0 bg-gradient-to-br from-maroon-700 via-maroon-800 to-maroon-950" />
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
      <span className="absolute inset-0 flex flex-col justify-between p-3.5 sm:p-6">
        {banner.offerText ? (
          <span className="self-start rounded-full border border-white/70 bg-marigold-400 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-ink shadow-lift sm:px-4 sm:py-2 sm:text-sm">
            {offerPercent}
          </span>
        ) : <span />}
        <span className="max-w-md">
          <span className="block max-w-[92%] font-display text-xl font-bold leading-tight text-white drop-shadow-sm sm:max-w-md sm:text-2xl">
            {banner.title}
          </span>
          {banner.subtitle ? (
            <span className="mt-1 block max-w-[92%] text-[13px] text-white/90 sm:text-[15px]">{banner.subtitle}</span>
          ) : null}
          {banner.ctaText ? (
            <span className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-maroon-700 shadow-lift transition-all group-hover:gap-2.5 group-hover:bg-marigold-400 sm:px-6">
              {banner.ctaText}
              <ArrowRight size={17} />
            </span>
          ) : null}
          {banner.expiresAt ? <OfferCountdown expiresAt={banner.expiresAt} /> : null}
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

function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => getRemaining(expiresAt));

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(getRemaining(expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (!remaining) return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/35 bg-black/55 px-2.5 py-1.5 text-[11px] font-bold text-white backdrop-blur sm:text-xs">
      Offer ends in <strong className="text-marigold-300">{remaining}</strong>
    </span>
  );
}

function getRemaining(expiresAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (seconds <= 0) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
  const { data: couponData } = useProductCouponOffers([product.id]);
  const discountPercent =
    product.mrpMinor > product.priceMinor ? Math.round(((product.mrpMinor - product.priceMinor) / product.mrpMinor) * 100) : 0;
  const couponOffer = couponData?.items ? getBestCouponForProduct(product.id, product.priceMinor, couponData.items) : null;

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
          {product.type === 'BOTH' ? <Badge>Ready + Custom</Badge> : null}
          {discountPercent > 0 ? <Badge>{discountPercent}% OFF</Badge> : null}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink">{product.name}</h3>
        {product.type === 'SHOWCASE' ? (
          <p className="hint">Jald aa raha hai</p>
        ) : (
          <div className="space-y-1">
            <Price
              price={{ priceMinor: product.priceMinor, mrpMinor: product.mrpMinor, discountPercent }}
              currency={currency}
              size="sm"
              couponOffer={couponOffer ? { code: couponOffer.code, description: couponOffer.description, finalPriceMinor: couponOffer.finalPriceMinor, discountMinor: couponOffer.discountMinor, savingsPercent: couponOffer.savingsPercent } : undefined}
            />
            {couponOffer ? (
              <p className="text-[10px] font-medium text-leaf">
                Get at {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(couponOffer.finalPriceMinor / 100)} with {couponOffer.code}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Link>
  );
}