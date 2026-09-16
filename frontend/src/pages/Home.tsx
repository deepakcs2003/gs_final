import { Link } from 'react-router-dom';
import { Scissors, ShoppingBag, GalleryHorizontalEnd } from 'lucide-react';
import { ProductCardView } from '../components/product/ProductCard';
import { HomeBannerRail } from '../components/home/HomeManagerContent';
import { InfiniteSentinel } from '../components/InfiniteSentinel';
import { CardSkeleton } from '../components/ui';
import { useCategories, useConfig, useHomeFeed, useProductsByRef, type HomeSection } from '../hooks/queries';
import { useRecentlyViewed } from '../store/ui';

/**
 * Homepage (README §2, §5).
 *
 * Designs start within one screen of the top — the three section tiles are a
 * single compact strip, not a full-height hero. Everything below is infinite
 * scroll: no "See More" button anywhere.
 */

const SECTIONS = [
  {
    to: '/customize',
    title: 'Customize',
    subtitle: 'Apne naap ka',
    icon: Scissors,
    className: 'bg-marigold-500 text-ink',
  },
  {
    to: '/ready-to-buy',
    title: 'Ready to Buy',
    subtitle: 'Turant delivery',
    icon: ShoppingBag,
    className: 'bg-maroon-600 text-white',
  },
  {
    to: '/our-work',
    title: 'Our Work',
    subtitle: 'Hamara Kaam',
    icon: GalleryHorizontalEnd,
    className: 'bg-white text-maroon-700 border-2 border-maroon-200',
  },
];

export function HomePage() {
  const { data: config } = useConfig();
  const { data: categories } = useCategories();
  const currency = config?.currency ?? 'INR';

  const feed = useHomeFeed();
  const recentSlugs = useRecentlyViewed((state) => state.slugs);

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-5">
      {/* Section tiles — deliberately short so designs are visible immediately.
          Tighter on phones, where every pixel above the fold costs a design. */}
      <section className="grid grid-cols-3 gap-2 pt-3 sm:gap-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className={`flex flex-col gap-1 rounded-xl p-2.5 shadow-card transition active:scale-[0.98] sm:gap-2 sm:rounded-xl2 sm:p-4 ${section.className}`}
          >
            <section.icon className="h-[18px] w-[18px] opacity-90 sm:h-6 sm:w-6" />
            <span>
              <span className="block text-[12px] font-bold leading-tight sm:text-[15px]">{section.title}</span>
              <span className="block text-[10.5px] leading-tight opacity-80 sm:text-[12px]">{section.subtitle}</span>
            </span>
          </Link>
        ))}
      </section>

      {/* Category chips */}
      {categories && categories.length > 0 ? (
        <section className="pt-4" aria-label="Categories">
          <div className="rail">
            {categories.map((category) => (
              <Link
                key={category.id}
                to={`/ready-to-buy/${category.slug}`}
                className="chip shrink-0 hover:border-maroon-400 hover:text-maroon-700"
              >
                {category.name}
              </Link>
            ))}
            <Link to="/ready-to-buy?sort=popular" className="chip shrink-0 hover:border-maroon-400 hover:text-maroon-700">
              Trending Designs
            </Link>
          </div>
        </section>
      ) : null}

      {/* Admin-managed promo banners (README §85.13) */}
      <HomeBannerRail position="hero" className="pt-4" />

      {/* Recently viewed (README §65) */}
      {recentSlugs.length > 0 ? <RecentlyViewedRail /> : null}

      <HomeBannerRail position="mid" className="pt-6" />

      {/* Infinite category feed */}
      {feed.isLoading ? (
        <div className="pt-8">
          <div className="skeleton mb-3 h-6 w-40 rounded" />
          <ProductGridSkeleton count={6} />
        </div>
      ) : null}

      {mergeFeedSections(feed.data?.pages.flatMap((page) => page.sections) ?? []).map((section) => (
        <section key={section.id} className="pt-8">
          <SectionHeading title={section.title} hint={section.titleHi} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {section.items.map((product) => (
              <ProductCardView key={product.id} product={product} currency={currency} />
            ))}
          </div>
        </section>
      ))}

      <InfiniteSentinel
        onVisible={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        disabled={!feed.hasNextPage}
        loading={feed.isFetchingNextPage}
      />

      {!feed.hasNextPage && !feed.isLoading ? (
        <p className="pb-6 text-center text-sm text-ink-muted">Bas! Aapne saare designs dekh liye 🌸</p>
      ) : null}

      {/* Footer promotions (README §85.13) */}
      <HomeBannerRail position="footer" className="pb-8 pt-2" />
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-end gap-3">
      <div className="min-w-0">
        <h2 className="section-title truncate">{title}</h2>
        {hint ? <p className="hint truncate">{hint}</p> : null}
      </div>
    </div>
  );
}

function mergeFeedSections(sections: HomeSection[]): HomeSection[] {
  const merged = new Map<string, HomeSection>();
  for (const section of sections) {
    const existing = merged.get(section.id);
    if (existing) {
      existing.items.push(...section.items);
    } else {
      merged.set(section.id, { ...section, items: [...section.items] });
    }
  }
  return [...merged.values()];
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}

function RecentlyViewedRail() {
  const slugs = useRecentlyViewed((state) => state.slugs);
  const { data: config } = useConfig();
  const { data: products } = useProductsByRef({ slugs });

  if (!products || products.length === 0) return null;

  return (
    <section className="pt-8">
      <h2 className="section-title mb-3">Aapne haal mein dekha</h2>
      <div className="rail">
        {products.map((product) => (
          <div key={product.id} className="w-40 shrink-0 sm:w-44">
            <ProductCardView product={product} currency={config?.currency ?? 'INR'} />
          </div>
        ))}
      </div>
    </section>
  );
}
