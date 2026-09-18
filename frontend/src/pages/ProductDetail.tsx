import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Heart, Share2, MessageCircle, Scissors, ChevronDown, Truck, Ruler } from 'lucide-react';
import clsx from 'clsx';
import { ZoomableImage } from '../components/product/ZoomableImage';
import { SmartImage } from '../components/SmartImage';
import { ProductCardView } from '../components/product/ProductCard';
import { FabricSheet } from '../components/customize/FabricSheet';
import { Badge, EmptyState, Price, Stars } from '../components/ui';
import { FloatingActions } from '../components/layout/FloatingActions';
import { useConfig, useProduct, useProductCouponOffers, useReviews, useSimilarProducts } from '../hooks/queries';
import { useCart } from '../store/cart';
import { useRecentlyViewed, useUi, useWishlist } from '../store/ui';
import { track, trackProductView } from '../lib/analytics';
import { api } from '../lib/api';
import { getBestCouponForProduct } from '../lib/coupons';
import { formatDate, formatMoney, whatsappEnquiryUrl } from '../lib/format';

const IMAGE_KIND_LABEL: Record<string, string> = {
  front: 'Front',
  back: 'Back',
  side: 'Side',
  sleeve: 'Sleeve',
  fabric: 'Fabric',
  embroidery: 'Embroidery',
  model: 'Model',
  other: 'View',
};

export function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { data: product, isLoading, isError } = useProduct(slug);
  const { data: similar } = useSimilarProducts(slug);
  const { data: reviews } = useReviews(product?.id);
  const { data: couponData } = useProductCouponOffers(product ? [product.id] : []);

  const addToCart = useCart((state) => state.add);
  const startBuy = useCart((state) => state.startBuy);
  const toggleWishlist = useWishlist((state) => state.toggle);
  const wishlisted = useWishlist((state) => (product ? state.ids.includes(product.id) : false));
  const pushRecent = useRecentlyViewed((state) => state.push);
  const toast = useUi((state) => state.toast);

  const [activeImage, setActiveImage] = useState(0);
  const [colorSlug, setColorSlug] = useState('');
  const [size, setSize] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [fabricOpen, setFabricOpen] = useState(false);
  const [buyNowRequested, setBuyNowRequested] = useState(false);
  const sizePickerRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  const currency = config?.currency ?? 'INR';

  /** Times the visit so the admin can see which designs actually hold attention. */
  useEffect(() => {
    if (!product) return undefined;
    pushRecent(product.slug);
    return trackProductView(product.id);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Per-product SEO title and description (README §57). */
  useEffect(() => {
    if (!product) return undefined;
    const previousTitle = document.title;
    document.title = product.seo.title;

    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute('content') ?? '';
    meta?.setAttribute('content', product.seo.description);

    return () => {
      document.title = previousTitle;
      meta?.setAttribute('content', previousDescription);
    };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeColor = colorSlug || product?.colors[0]?.slug || '';

  const sizeStatus = useMemo(() => {
    const map = new Map<number, { available: boolean; lowStock: number | null }>();
    for (const cell of product?.availability ?? []) {
      if (cell.colorSlug !== activeColor) continue;
      map.set(cell.size, { available: cell.available, lowStock: cell.lowStock });
    }
    return map;
  }, [product, activeColor]);

  if (isLoading) return <ProductSkeleton />;

  if (isError || !product) {
    return (
      <EmptyState
        icon={<Scissors size={30} />}
        title="Yeh design nahi mila"
        message="Ho sakta hai yeh hata diya gaya ho. Doosre designs dekhein."
        action={
          <Link to="/ready-to-buy" className="btn-primary">
            Designs dekhein
          </Link>
        }
      />
    );
  }

  const selectedStatus = size !== null ? sizeStatus.get(size) : undefined;
  const couponOffer = couponData?.items ? getBestCouponForProduct(product.id, product.price.priceMinor, couponData.items) : null;
  const productUrl = `${window.location.origin}/blouse/${product.slug}`;

  const onShare = async () => {
    track('SHARE', { productId: product.id });
    const shareData = {
      title: product.name,
      text: `${product.name} — Guddi Silai`,
      url: productUrl,
    };

    // Native share sheet on phones (README §10); clipboard everywhere else.
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* customer dismissed the sheet */
      }
    }

    try {
      await navigator.clipboard.writeText(productUrl);
      toast('Link copy ho gaya 🔗', 'success');
    } catch {
      toast('Link copy nahi hua', 'error');
    }
  };

  const onWhatsApp = () => {
    track('WHATSAPP_CLICK', { productId: product.id });
    void api('/enquiries', {
      method: 'POST',
      body: { productId: product.id, channel: 'WHATSAPP', message: product.designId },
      quiet: true,
    }).catch(() => undefined);
  };

  const addReadyMade = (thenCheckout: boolean) => {
    if (size === null) {
      setBuyNowRequested(true);
      return;
    }
    const key = addToCart({ product, colorSlug: activeColor, size, quantity });
    if (thenCheckout) {
      track('BUY_NOW', { productId: product.id });
      startBuy(key);
      navigate('/checkout');
    } else {
      toast('Cart mein daal diya 🛒', 'success');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-5">
      <nav className="mb-3 flex items-center gap-1.5 text-[13px] text-ink-muted">
        <Link to="/" className="hover:underline">
          Home
        </Link>
        <span>›</span>
        <Link
          to={product.type === 'READY_MADE' || product.type === 'BOTH' ? '/ready-to-buy' : product.type === 'CUSTOMIZE' ? '/customize' : '/showcase'}
          className="hover:underline"
        >
          {product.type === 'READY_MADE' || product.type === 'BOTH'
            ? 'Ready to Buy'
            : product.type === 'CUSTOMIZE'
              ? 'Customize'
              : 'Showcase'}
        </Link>
        {product.category ? (
          <>
            <span>›</span>
            <span className="truncate">{product.category.name}</span>
          </>
        ) : null}
      </nav>

      <div className="lg:grid lg:grid-cols-2 lg:gap-8">
        {/* Gallery (README §7–8) */}
        <div className="lg:sticky lg:top-[calc(var(--header-h)+16px)] lg:self-start">
          <div
            onTouchStart={(event) => {
              if (product.images.length <= 1) return;
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              if (product.images.length <= 1 || touchStartX.current === null) return;
              const currentX = event.changedTouches[0]?.clientX ?? touchStartX.current;
              const delta = currentX - touchStartX.current;
              if (Math.abs(delta) < 60) {
                touchStartX.current = null;
                return;
              }
              if (delta < 0 && activeImage < product.images.length - 1) {
                setActiveImage((prev) => prev + 1);
              } else if (delta > 0 && activeImage > 0) {
                setActiveImage((prev) => prev - 1);
              }
              touchStartX.current = null;
            }}
          >
            <ZoomableImage
              src={product.images[activeImage]?.url ?? product.image}
              alt={product.images[activeImage]?.alt ?? product.name}
              aspectRatio={
                product.images[activeImage]?.width && product.images[activeImage]?.height
                  ? product.images[activeImage].width / product.images[activeImage].height
                  : undefined
              }
              onZoom={() => track('IMAGE_ZOOM', { productId: product.id })}
            />
          </div>

          {product.images.length > 1 ? (
            <div className="rail mt-3">
              {product.images.map((image, index) => (
                <button
                  key={image.url + index}
                  type="button"
                  onClick={() => {
                    setActiveImage(index);
                    track('PRODUCT_IMAGE_VIEW', { productId: product.id, value: index });
                  }}
                  aria-label={IMAGE_KIND_LABEL[image.kind] ?? 'View'}
                  aria-pressed={index === activeImage}
                  className={clsx(
                    'w-16 shrink-0 overflow-hidden rounded-lg border-2 transition',
                    index === activeImage ? 'border-maroon-600' : 'border-transparent opacity-70',
                  )}
                >
                  <span
                    className="block"
                    style={{ aspectRatio: image.width && image.height ? image.width / image.height : 3 / 4 }}
                  >
                    <SmartImage src={image.url} alt={image.alt} className="object-contain" sizes="64px" />
                  </span>
                  <span className="block bg-white py-0.5 text-center text-[9.5px] font-semibold text-ink-muted">
                    {IMAGE_KIND_LABEL[image.kind] ?? 'View'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Details */}
        <div className="pt-5 lg:pt-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-[22px] font-bold leading-tight text-ink sm:text-2xl">{product.name}</h1>
              <p className="mt-1 text-[13px] text-ink-muted">
                Design ID: <span className="font-semibold text-ink">{product.designId}</span>
                {product.category ? ` • ${product.category.name}` : ''}
              </p>
            </div>
            <button
              type="button"
              aria-label={wishlisted ? 'Wishlist se hatayein' : 'Wishlist mein daalein'}
              onClick={() => {
                const added = toggleWishlist(product.id);
                toast(added ? 'Wishlist mein daal diya ❤️' : 'Wishlist se hata diya', 'success');
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-light/25 bg-white"
            >
              <Heart size={20} className={clsx(wishlisted ? 'fill-alert text-alert' : 'text-ink-muted')} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Stars value={product.rating.average} count={product.rating.count} size={15} />
            {product.comingSoon ? <Badge tone="dark">Coming Soon</Badge> : null}
          </div>

          {product.type !== 'SHOWCASE' ? (
            <div className="mt-3">
              <Price
                price={product.price}
                currency={currency}
                size="lg"
                couponOffer={couponOffer ? { code: couponOffer.code, description: couponOffer.description, finalPriceMinor: couponOffer.finalPriceMinor, discountMinor: couponOffer.discountMinor, savingsPercent: couponOffer.savingsPercent } : undefined}
              />
              {couponOffer ? (
                <div className="mt-2 rounded-lg border border-leaf/20 bg-leaf/5 px-2.5 py-1.5 text-[12px] text-leaf">
                  <span className="font-bold">Get at</span>{' '}
                  {formatMoney(couponOffer.finalPriceMinor, currency)}{' '}
                  <span className="font-bold">with</span>{' '}
                  {couponOffer.code}
                  {couponOffer.description ? ` • ${couponOffer.description}` : ''}
                </div>
              ) : null}
              <p className="hint mt-1">
                {currency === 'INR' ? 'Sab taxes included' : 'Delivery charge payment ke time add hoga'}
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-xl bg-marigold-50 px-3.5 py-3 text-[14px] font-semibold text-marigold-800">
              {product.expectedAvailability
                ? `Expected: ${product.expectedAvailability}`
                : 'Yeh design jald available hoga'}
            </p>
          )}

          {/* READY_MADE / BOTH: colour + size */}
          {product.type === 'READY_MADE' || product.type === 'BOTH' ? (
            <div className="mt-6 space-y-5">
              <section>
                <h2 className="label">
                  Color
                  <span className="ml-1 font-normal text-ink-muted">
                    — {product.colors.find((c) => c.slug === activeColor)?.name}
                  </span>
                </h2>
                <div className="flex flex-wrap gap-2.5">
                  {product.colors.map((color) => (
                    <button
                      key={color.slug}
                      type="button"
                      aria-label={color.name}
                      aria-pressed={color.slug === activeColor}
                      onClick={() => {
                        setColorSlug(color.slug);
                        setSize(null);
                      }}
                      className={clsx(
                        'flex h-12 items-center gap-2 rounded-xl border-2 px-3 transition',
                        color.slug === activeColor ? 'border-maroon-600 bg-maroon-50' : 'border-ink-light/25 bg-white',
                      )}
                    >
                      <span className="h-6 w-6 rounded-full border border-ink-light/40" style={{ backgroundColor: color.hex }} />
                      <span className="text-sm font-semibold">{color.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section
                ref={sizePickerRef}
                className={clsx('rounded-xl p-1 transition', buyNowRequested && size === null && 'bg-maroon-50 ring-2 ring-maroon-200')}
              >
                <h2 className="label">Size</h2>
                <div className="flex flex-wrap gap-2.5">
                  {product.sizes.map((value) => {
                    const status = sizeStatus.get(value);
                    const unavailable = status?.available === false;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={unavailable}
                        aria-pressed={size === value}
                        onClick={() => {
                          setSize(value);
                          setBuyNowRequested(false);
                        }}
                        className={clsx(
                          'relative h-12 min-w-[56px] rounded-xl border-2 text-base font-bold transition',
                          unavailable && 'cursor-not-allowed border-ink-light/20 bg-maroon-50/40 text-ink-light',
                          !unavailable && size === value && 'border-maroon-600 bg-maroon-600 text-white',
                          !unavailable && size !== value && 'border-ink-light/25 bg-white',
                        )}
                      >
                        {value}
                        {unavailable ? (
                          <span className="pointer-events-none absolute inset-0 grid place-items-center">
                            <span className="h-[1.5px] w-9 rotate-[-20deg] bg-ink-light/70" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {selectedStatus?.available === false ? (
                  <p className="mt-2 text-sm font-medium text-alert">Yeh color aur size out of stock hai.</p>
                ) : null}
                {selectedStatus?.lowStock ? (
                  <p className="mt-2 text-sm font-medium text-marigold-700">
                    Sirf {selectedStatus.lowStock} bache hain.
                  </p>
                ) : null}
              </section>

              <section>
                <h2 className="label">Kitne chahiye?</h2>
                <div className="inline-flex items-center gap-1 rounded-xl border border-ink-light/25 bg-white p-1">
                  <button
                    type="button"
                    aria-label="Kam karein"
                    className="h-10 w-10 rounded-lg text-xl font-bold text-maroon-700 disabled:opacity-40"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-base font-bold">{quantity}</span>
                  <button
                    type="button"
                    aria-label="Zyada karein"
                    className="h-10 w-10 rounded-lg text-xl font-bold text-maroon-700 disabled:opacity-40"
                    disabled={quantity >= 20}
                    onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                  >
                    +
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {/* CUSTOMIZE / BOTH: three-step explainer */}
          {product.type === 'CUSTOMIZE' || product.type === 'BOTH' ? (
            <div className="mt-6 rounded-xl2 bg-marigold-50 p-4">
              <h2 className="mb-2.5 flex items-center gap-2 font-display text-base font-bold text-ink">
                <Ruler size={18} />
                Sirf 3 step mein
              </h2>
              <ol className="space-y-2 text-[14px] text-ink">
                <li className="flex gap-2.5">
                  <StepDot n={1} />
                  Fabric aur lace choose karein
                </li>
                <li className="flex gap-2.5">
                  <StepDot n={2} />
                  Apna measurement dein (GIF dekh kar aasaan hai)
                </li>
                <li className="flex gap-2.5">
                  <StepDot n={3} />
                  Order karein — {product.stitchingDays} din mein silai
                </li>
              </ol>
              <p className="mt-2.5 rounded-lg bg-white/70 px-2.5 py-2 text-[12px] font-semibold text-maroon-700">
                Is blouse ke liye: {product.minFabricCount}-{product.maxFabricCount} fabrics · {product.minLaceCount}-{product.maxLaceCount} laces · {product.minLatkanCount}-{product.maxLatkanCount} latkans
              </p>
            </div>
          ) : null}

          {/* Desktop actions (mobile uses the sticky bar below) */}
          <div className="mt-6 hidden gap-3 lg:flex">
            <ProductActions
              product={product}
              onBuyNow={() => addReadyMade(true)}
              onCustomize={() => setFabricOpen(true)}
            />
          </div>

          {/* Share + WhatsApp */}
          <div className="mt-4 flex gap-2.5">
            {config?.whatsappNumber ? (
              <a
                href={whatsappEnquiryUrl({
                  number: config.whatsappNumber,
                  productName: product.name,
                  designId: product.designId,
                  category: product.category?.name ?? '',
                  url: productUrl,
                })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onWhatsApp}
                className="btn-outline flex-1 border-leaf text-leaf hover:bg-leaf/5"
              >
                <MessageCircle size={17} />
                WhatsApp Enquiry
              </a>
            ) : null}
            <button type="button" onClick={() => void onShare()} className="btn-outline flex-1">
              <Share2 size={17} />
              Share
            </button>
          </div>

          {product.type !== 'SHOWCASE' ? (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-white px-3.5 py-3 text-[13.5px] text-ink-muted shadow-card">
              <Truck size={17} className="shrink-0 text-maroon-600" />
              {product.type === 'CUSTOMIZE'
                ? `Silai mein lagbhag ${product.stitchingDays} din lagenge, phir delivery.`
                : 'Ready stock — 2-5 din mein delivery.'}
            </p>
          ) : null}

          {/* Product details (README §9) */}
          <div className="mt-6 space-y-2">
            <Accordion title="Product Details" defaultOpen>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[14px]">
                <Detail label="Design ID" value={product.designId} />
                <Detail label="Category" value={product.category?.name ?? '—'} />
                <Detail label="Fabric" value={product.fabricInfo || '—'} />
                <Detail label="Embroidery" value={product.embroidery.join(', ') || '—'} />
                <Detail label="Colors" value={product.colors.map((c) => c.name).join(', ') || '—'} />
                <Detail label="Sizes" value={product.sizes.join(', ') || 'Custom'} />
              </dl>
              {product.description ? <p className="mt-4 text-[14px] leading-relaxed text-ink">{product.description}</p> : null}
            </Accordion>

            {product.stitchingInfo ? (
              <Accordion title="Stitching Information">
                <p className="text-[14px] leading-relaxed text-ink">{product.stitchingInfo}</p>
              </Accordion>
            ) : null}

            {product.careInstructions ? (
              <Accordion title="Care Instructions">
                <p className="text-[14px] leading-relaxed text-ink">{product.careInstructions}</p>
              </Accordion>
            ) : null}
          </div>

          {/* Reviews (README §34) */}
          {reviews && reviews.length > 0 ? (
            <section className="mt-8">
              <h2 className="section-title mb-3">Customer Reviews</h2>
              <ul className="space-y-3">
                {reviews.map((review) => (
                  <li key={review.id} className="card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-bold text-ink">{review.name}</span>
                      <Stars value={review.rating} />
                    </div>
                    {review.text ? <p className="mt-1.5 text-[14px] leading-relaxed text-ink">{review.text}</p> : null}
                    <p className="hint mt-1.5">
                      {review.verifiedPurchase ? '✓ Verified purchase • ' : ''}
                      {formatDate(review.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {/* Similar designs (README §68) */}
      {similar && similar.length > 0 ? (
        <section className="mt-10">
          <h2 className="section-title mb-3">Aapko yeh bhi pasand aayenge</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {similar.slice(0, 6).map((item) => (
              <ProductCardView key={item.id} product={item} currency={currency} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Mobile sticky action bar — always one obvious next step (README §81) */}
      <div
        className="fixed inset-x-0 z-30 border-t border-maroon-100 bg-white/97 px-3 py-2.5 shadow-sheet backdrop-blur lg:hidden"
        style={{ bottom: 'calc(var(--bottomnav-h) + var(--safe-bottom))' }}
      >
        <div className="flex gap-2.5">
          <ProductActions
            product={product}
            onBuyNow={() => addReadyMade(true)}
            onCustomize={() => setFabricOpen(true)}
          />
        </div>
      </div>
      <div className="h-16 lg:hidden" />

      <FloatingActions product={product} />

      {fabricOpen ? (
        <FabricSheet
          open
          onClose={() => setFabricOpen(false)}
          product={product}
          currency={currency}
              onConfirm={({ fabrics, laces, latkans, measurement, note }) => {
              const key = addToCart({
                product,
                fabricId: fabrics[0].id,
                fabricIds: fabrics.map((fabric) => fabric.id),
                fabricName: fabrics.map((fabric) => `${fabric.colorName} ${fabric.name}`).join(', '),
                laceIds: laces.map((l) => l.id),
                laceColors: laces.map(({ id, colorName, colorHex }) => ({ id, colorName, colorHex })),
                laceName: laces
                  .map((l) => (l.colorName && l.colorName !== l.name ? `${l.name} (${l.colorName})` : l.name))
                  .join(', '),
                latkanIds: latkans.map((l) => l.id),
                latkanColors: latkans.map(({ id, colorName, colorHex }) => ({ id, colorName, colorHex })),
                latkanName: latkans
                  .map((l) => (l.colorName && l.colorName !== l.name ? `${l.name} (${l.colorName})` : l.name))
                  .join(', '),
                measurement,
                note,
              });
              setFabricOpen(false);
              startBuy(key);
              navigate('/checkout');
            }}
        />
      ) : null}
    </div>
  );
}

function ProductActions({
  product,
  onBuyNow,
  onCustomize,
}: {
  product: { type: string };
  onBuyNow: () => void;
  onCustomize: () => void;
}) {
  if (product.type === 'SHOWCASE') {
    return (
      <Link to="/showcase" className="btn-outline btn-lg w-full">
        Aur upcoming designs dekhein
      </Link>
    );
  }

  if (product.type === 'CUSTOMIZE') {
    return (
      <div className="flex w-full gap-2.5">
        <button type="button" onClick={onCustomize} className="btn-primary btn-lg w-full">
          <Scissors size={18} />
          Buy Now
        </button>
      </div>
    );
  }

  if (product.type === 'BOTH') {
    return (
      <div className="flex w-full flex-col gap-2.5">
        <button type="button" onClick={onBuyNow} className="btn-primary btn-lg w-full">
          Buy Now
        </button>
        <button type="button" onClick={onCustomize} className="btn-accent btn-lg w-full">
          <Scissors size={18} />
          Custom banwayein
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={onBuyNow} className="btn-primary btn-lg w-full">
      Buy Now
    </button>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-maroon-600 text-[12px] font-bold text-white">
      {n}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Accordion({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="text-[15px] font-bold text-ink">{title}</span>
        <ChevronDown size={19} className={clsx('text-ink-muted transition', open && 'rotate-180')} />
      </button>
      {open ? <div className="border-t border-maroon-100 px-4 py-3.5">{children}</div> : null}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-5 lg:grid lg:grid-cols-2 lg:gap-8">
      <div className="skeleton aspect-[3/4] w-full rounded-xl2" />
      <div className="space-y-3 pt-5 lg:pt-0">
        <div className="skeleton h-7 w-3/4 rounded" />
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-8 w-1/2 rounded" />
        <div className="skeleton h-12 w-full rounded-xl" />
        <div className="skeleton h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
