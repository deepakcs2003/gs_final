import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Heart, ShoppingCart, Menu } from 'lucide-react';
import clsx from 'clsx';
import { useCart } from '../../store/cart';
import { useUi, useWishlist } from '../../store/ui';

/**
 * Mobile bottom navigation (README §55): Home | Categories | Wishlist | Cart |
 * Menu. Sits within the safe area so it clears the iPhone home indicator, and
 * hides on desktop where the header already carries these links.
 */

const ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/ready-to-buy', label: 'Categories', icon: LayoutGrid },
  { to: '/wishlist', label: 'Wishlist', icon: Heart, badge: 'wishlist' as const },
  { to: '/cart', label: 'Cart', icon: ShoppingCart, badge: 'cart' as const },
];

export function BottomNav() {
  const cartCount = useCart((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0));
  const wishlistCount = useWishlist((state) => state.ids.length);
  const toggleMenu = useUi((state) => state.toggleMenu);

  const badgeFor = (kind?: 'wishlist' | 'cart') =>
    kind === 'cart' ? cartCount : kind === 'wishlist' ? wishlistCount : 0;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-maroon-100 bg-white/97 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="Main navigation"
    >
      <div className="mx-auto grid h-[var(--bottomnav-h)] max-w-lg grid-cols-5">
        {ITEMS.map((item) => {
          const count = badgeFor(item.badge);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'relative flex flex-col items-center justify-center gap-0.5 no-tap-highlight transition',
                  isActive ? 'text-maroon-700' : 'text-ink-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <item.icon size={22} className={clsx(isActive && item.badge === 'wishlist' && 'fill-alert text-alert')} />
                    {count > 0 ? (
                      <span className="absolute -right-2 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-maroon-600 px-1 text-[10px] font-bold text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[10.5px] font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={() => toggleMenu(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-ink-muted no-tap-highlight"
        >
          <Menu size={22} />
          <span className="text-[10.5px] font-semibold">Menu</span>
        </button>
      </div>
    </nav>
  );
}
