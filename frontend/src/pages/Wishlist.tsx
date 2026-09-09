import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { ProductCardView } from '../components/product/ProductCard';
import { EmptyState, CardSkeleton } from '../components/ui';
import { useConfig, useProductsByRef } from '../hooks/queries';
import { useWishlist } from '../store/ui';

/**
 * Wishlist (README §26). Works signed-out — ids live in the browser and are
 * merged into the account on login.
 */
export function WishlistPage() {
  const ids = useWishlist((state) => state.ids);
  const { data: config } = useConfig();
  const { data: products, isLoading } = useProductsByRef({ ids });

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={<Heart size={30} />}
        title="Wishlist khaali hai"
        message="Jo design pasand aaye uspar ❤️ dabayein — yahan save ho jayega."
        action={
          <Link to="/ready-to-buy" className="btn-primary">
            Designs dekhein
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-5">
      <h1 className="section-title mb-1">Meri Wishlist</h1>
      <p className="hint mb-4">{ids.length} design save kiye hain</p>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: Math.min(ids.length, 6) }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {products?.map((product) => (
            <ProductCardView key={product.id} product={product} currency={config?.currency ?? 'INR'} />
          ))}
        </div>
      )}
    </div>
  );
}
