import { memo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, ShoppingCart, Scissors, Eye } from 'lucide-react';
import clsx from 'clsx';
import { SmartImage } from '../SmartImage';
import { Badge, ColorDots, Price, Stars } from '../ui';
import { VariantPicker } from './VariantPicker';
import { FabricSheet } from '../customize/FabricSheet';
import { useCart } from '../../store/cart';
import { useUi, useWishlist } from '../../store/ui';
import { useProductCouponOffers } from '../../hooks/queries';
import { track } from '../../lib/analytics';
import { getBestCouponForProduct, getProductSignal } from '../../lib/coupons';
import { ProductCard as ProductCardType } from '../../lib/types';
import type { Currency } from '../../lib/format';

/**
 * The product card (README §6).
 *
 * Kept deliberately plain: image, name, price, rating, colours, sizes and one
 * obvious action. Which actions appear is decided by product type — READY_MADE
 * and SHOWCASE each have their own path, and BOTH offers the readymade pair
 * alongside a custom-stitch option (README §83).
 */

interface ProductCardProps {
  product: ProductCardType;
  currency: Currency;
  eager?: boolean;
}

function ProductCardViewInner({ product, currency, eager }: ProductCardProps) {
  const navigate = useNavigate();
  const addToCart = useCart((state) => state.add);
  const startBuy = useCart((state) => state.startBuy);
  const toggleWishlist = useWishlist((state) => state.toggle);
  const wishlisted = useWishlist((state) => state.ids.includes(product.id));
  const toast = useUi((state) => state.toast);

  const [picker, setPicker] = useState<null | 'cart' | 'buy'>(null);
  const [fabricOpen, setFabricOpen] = useState(false);
  const { data: couponData } = useProductCouponOffers([product.id]);

  const href = `/blouse/${product.slug}`;
  const soldOut = (product.type === 'READY_MADE' || product.type === 'BOTH') && !product.inStock;
  const couponOffer = couponData?.items ? getBestCouponForProduct(product.id, product.price.priceMinor, couponData.items) : null;
  const productSignal = getProductSignal(product.id);

  return (
    <article className="group card flex min-w-0 flex-col overflow-hidden">
      <div className="relative min-w-0">
        <Link to={href} className="block aspect-[3/4] overflow-hidden bg-maroon-50" aria-label={product.name}>
          <SmartImage
            src={product.image}
            alt={product.imageAlt}
            eager={eager}
            className="transition-transform duration-500 group-hover:scale-[1.04]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        </Link>

        {/* Badges: only truthful ones. Low stock comes from real inventory. */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1.5">
          {product.price.discountPercent > 0 && !soldOut ? (
            <Badge>{product.price.discountPercent}% OFF</Badge>
          ) : null}
          {product.comingSoon ? <Badge tone="dark">Coming Soon</Badge> : null}
          {soldOut ? <Badge tone="dark">Out of Stock</Badge> : null}
          {product.lowStock ? <Badge tone="alert">Sirf {product.lowStock} bache</Badge> : null}
        </div>

        <button
          type="button"
          aria-label={wishlisted ? 'Wishlist se hatayein' : 'Wishlist mein daalein'}
          aria-pressed={wishlisted}
          onClick={() => {
            const added = toggleWishlist(product.id);
            toast(added ? 'Wishlist mein daal diya ❤️' : 'Wishlist se hata diya', 'success');
          }}
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-white/95 shadow-card backdrop-blur transition active:scale-90"
        >
          <Heart
            size={19}
            className={clsx('transition', wishlisted ? 'fill-alert text-alert' : 'text-ink-muted')}
          />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <Link to={href} className="min-h-[38px] min-w-0">
          <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink sm:text-[14px]">{product.name}</h3>
        </Link>

        {product.type !== 'SHOWCASE' ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <div className={clsx(
              'inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] sm:text-[10px]',
              product.type === 'CUSTOMIZE' && 'border-amber-200 bg-amber-50 text-amber-800',
              product.type === 'READY_MADE' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
              product.type === 'BOTH' && 'border-violet-200 bg-violet-50 text-violet-700',
            )}>
              {product.type === 'READY_MADE' ? 'Ready to Buy' : product.type === 'CUSTOMIZE' ? 'Customize' : 'Ready + Customize'}
            </div>

            <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-1 text-[9.5px] font-semibold text-amber-800 sm:text-[10px]">
              <span className="text-amber-500">★</span>
              <span>{productSignal.rating.toFixed(1)}</span>
            </div>

            <div className="shrink-0 text-[9.5px] font-medium text-ink-muted sm:text-[10px]">{productSignal.salesCount} sold</div>
          </div>
        ) : null}

        {product.type === 'SHOWCASE' ? (
          <p className="hint">{product.expectedAvailability || 'Jald aa raha hai'}</p>
        ) : (
          <div className="space-y-1">
            <Price
              price={product.price}
              currency={currency}
              couponOffer={couponOffer ? { code: couponOffer.code, description: couponOffer.description, finalPriceMinor: couponOffer.finalPriceMinor, discountMinor: couponOffer.discountMinor, savingsPercent: couponOffer.savingsPercent } : undefined}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stars value={product.rating.average} count={product.rating.count} />
          <ColorDots colors={product.colors} />
        </div>

        {product.sizes.length > 0 ? (
          <p className="text-[12px] text-ink-muted">Size: {product.sizes.join(', ')}</p>
        ) : null}

        <div className="mt-auto pt-1">
          {product.type === 'READY_MADE' ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={soldOut}
                onClick={() => setPicker('cart')}
                className="btn-outline px-2 text-[13px]"
              >
                <ShoppingCart size={16} />
                Cart
              </button>
              <button
                type="button"
                disabled={soldOut}
                onClick={() => {
                  track('BUY_NOW', { productId: product.id });
                  setPicker('buy');
                }}
                className="btn-primary px-2 text-[13px]"
              >
                Buy Now
              </button>
            </div>
          ) : product.type === 'CUSTOMIZE' ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFabricOpen(true)} className="btn-outline px-2 text-[13px]">
                <ShoppingCart size={16} />
                Cart
              </button>
              <button
                type="button"
                onClick={() => {
                  track('BUY_NOW', { productId: product.id });
                  setFabricOpen(true);
                }}
                className="btn-primary px-2 text-[13px]"
              >
                <Scissors size={16} />
                Buy Now
              </button>
            </div>
          ) : product.type === 'BOTH' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => setPicker('cart')}
                  className="btn-outline px-2 text-[13px]"
                >
                  <ShoppingCart size={16} />
                  Cart
                </button>
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => {
                    track('BUY_NOW', { productId: product.id });
                    setPicker('buy');
                  }}
                  className="btn-primary px-2 text-[13px]"
                >
                  Buy Now
                </button>
              </div>
              <button type="button" onClick={() => setFabricOpen(true)} className="btn-outline w-full text-[13px]">
                <Scissors size={16} />
                Custom banwayein
              </button>
            </div>
          ) : (
            <Link to={href} className="btn-outline w-full text-[13px]">
              <Eye size={16} />
              Design Dekhein
            </Link>
          )}
        </div>
      </div>

      {picker ? (
        <VariantPicker
          open
          onClose={() => setPicker(null)}
          product={product}
          actionLabel={picker === 'buy' ? 'Buy Now' : 'Cart mein daalein'}
          onConfirm={({ colorSlug, size, quantity, detail }) => {
            const key = addToCart({ product: detail, colorSlug, size, quantity });
            setPicker(null);
            if (picker === 'buy') {
              startBuy(key);
              navigate('/checkout');
            } else {
              toast('Cart mein daal diya 🛒', 'success');
            }
          }}
        />
      ) : null}

      {fabricOpen ? (
        <FabricSheet
          open
          onClose={() => setFabricOpen(false)}
          product={product}
          currency={currency}
          onConfirm={({ fabrics, laces, latkans }) => {
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
              measurement: null,
            });
            setFabricOpen(false);
            // Fabric chosen → measurement is the next obvious step (README §17).
            navigate(`/measurement/${encodeURIComponent(key)}`, { state: { buyNow: true } });
          }}
        />
      ) : null}
    </article>
  );
}

// Cards are pure with respect to (product, currency, eager); memoising skips the
// whole variant-picker/fabric-sheet subtree when a grid re-renders and passes
// the same props — the common case while paginating feeds.
export const ProductCardView = memo(ProductCardViewInner);
ProductCardView.displayName = 'ProductCardView';
