import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Search, Heart, ShoppingCart, Menu, X, Package, Info, Phone, HelpCircle, LogOut, User, LayoutDashboard } from 'lucide-react';
import clsx from 'clsx';
import { useCart } from '../../store/cart';
import { useUi, useWishlist } from '../../store/ui';
import { useCurrentUser } from '../../hooks/queries';
import { api } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Header (README §2).
 *
 * Kept to one row so designs start immediately below it — About and Contact
 * live in the menu, not across the top of the homepage.
 */

const PRIMARY_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/ready-to-buy', label: 'Ready to Buy' },
  { to: '/customize', label: 'Customize' },
  { to: '/our-work', label: 'Our Work' },
];

const MENU_LINKS = [
  { to: '/orders', label: 'Track Order', icon: Package },
  { to: '/about', label: 'About Us', icon: Info },
  { to: '/contact', label: 'Contact Us', icon: Phone },
  { to: '/faq', label: 'FAQ', icon: HelpCircle },
];

const POLICY_LINKS = [
  { to: '/policy/shipping', label: 'Shipping Policy' },
  { to: '/policy/returns', label: 'Return Policy' },
  { to: '/policy/privacy', label: 'Privacy Policy' },
  { to: '/policy/terms', label: 'Terms & Conditions' },
];

export function Logo({ compact }: { compact?: boolean }) {
  // Shows /logo.png from the public folder when present; falls back to the
  // lettermark so the header never breaks while the file is missing.
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <Link to="/" className="flex items-center gap-2 no-tap-highlight" aria-label="Guddi Silai home">
      {logoFailed ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-maroon-600 font-display text-xl font-bold text-marigold-300">
          G
        </span>
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full">
          <img
            src="/logo.png"
            alt="Guddi Silai"
            className="h-full w-full object-cover"
            onError={() => setLogoFailed(true)}
          />
        </span>
      )}
      {!compact ? (
        <span className="leading-none">
          <span className="block font-display text-[17px] font-bold text-maroon-700">Guddi Silai</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-ink-muted">
            Blouse Designs
          </span>
        </span>
      ) : null}
    </Link>
  );
}

export function Header() {
  const cartCount = useCart((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0));
  const wishlistCount = useWishlist((state) => state.ids.length);
  const openSearch = useUi((state) => state.openSearch);
  const menuOpen = useUi((state) => state.menuOpen);
  const toggleMenu = useUi((state) => state.toggleMenu);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-maroon-100 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-[var(--header-h)] max-w-7xl items-center gap-3 px-3 sm:px-5">
          <Logo />

          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {PRIMARY_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-2 text-[15px] font-semibold transition',
                    isActive ? 'bg-maroon-600 text-white' : 'text-ink hover:bg-maroon-50 hover:text-maroon-700',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-0.5">
            <IconAction label="Search" onClick={openSearch}>
              <Search size={21} />
            </IconAction>

            <IconAction label="Wishlist" to="/wishlist" badge={wishlistCount}>
              <Heart size={21} />
            </IconAction>

            <IconAction label="Cart" to="/cart" badge={cartCount}>
              <ShoppingCart size={21} />
            </IconAction>

            {/* Desktop only — on phones the menu lives in the bottom nav, so
                having it here too would be the same control twice on one screen. */}
            <IconAction label="Menu" onClick={() => toggleMenu(true)} className="hidden lg:grid">
              <Menu size={22} />
            </IconAction>
          </div>
        </div>
      </header>

      <MenuDrawer open={menuOpen} onClose={() => toggleMenu(false)} />
    </>
  );
}

function IconAction({
  children,
  label,
  to,
  onClick,
  badge,
  className,
}: {
  children: React.ReactNode;
  label: string;
  to?: string;
  onClick?: () => void;
  badge?: number;
  className?: string;
}) {
  const content = (
    <>
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-maroon-600 px-1 text-[10px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </>
  );

  const base = clsx(
    'relative grid h-11 w-11 place-items-center rounded-full text-ink transition hover:bg-maroon-50 hover:text-maroon-700 no-tap-highlight',
    className,
  );

  if (to) {
    return (
      <Link to={to} aria-label={label} className={base}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" aria-label={label} onClick={onClick} className={base}>
      {content}
    </button>
  );
}

function MenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: user } = useCurrentUser();
  const openLogin = useUi((state) => state.openLogin);
  const toast = useUi((state) => state.toast);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (!open) return null;

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* logging out locally is what matters */
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    onClose();
    toast('Logout ho gaya', 'success');
    navigate('/');
  };

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Menu band karein" onClick={onClose} className="absolute inset-0 animate-fade-in bg-ink/50" />

      <aside className="absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-maroon-100 px-4 py-3.5">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Band karein"
            className="grid h-10 w-10 place-items-center rounded-full text-ink-muted hover:bg-maroon-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-4 rounded-xl2 bg-maroon-50 p-3.5">
            {user ? (
              <>
                <p className="text-sm font-bold text-ink">{user.name || 'Namaste 🙏'}</p>
                <p className="hint">{user.mobile || user.email}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink">Login karke apne orders dekhein</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openLogin();
                  }}
                  className="btn-primary mt-2.5 w-full"
                >
                  <User size={17} />
                  Login / Sign Up
                </button>
              </>
            )}
          </div>

          {user?.isAdmin ? (
            <Link
              to="/admin"
              onClick={onClose}
              className="mb-4 flex items-center gap-2 rounded-xl bg-maroon-700 px-3 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-maroon-800"
            >
              <LayoutDashboard size={18} />
              Admin Panel
            </Link>
          ) : null}

          <nav className="space-y-0.5">
            {PRIMARY_LINKS.map((link) => (
              <DrawerLink key={link.to} to={link.to} label={link.label} onClose={onClose} />
            ))}
            <div className="my-2 h-px bg-maroon-100" />
            {MENU_LINKS.map((link) => (
              <DrawerLink key={link.to} to={link.to} label={link.label} icon={link.icon} onClose={onClose} />
            ))}
            <div className="my-2 h-px bg-maroon-100" />
            {POLICY_LINKS.map((link) => (
              <DrawerLink key={link.to} to={link.to} label={link.label} onClose={onClose} small />
            ))}
          </nav>

          {user ? (
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-semibold text-alert hover:bg-maroon-50"
            >
              <LogOut size={18} />
              Logout
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function DrawerLink({
  to,
  label,
  icon: Icon,
  onClose,
  small,
}: {
  to: string;
  label: string;
  icon?: typeof Package;
  onClose: () => void;
  small?: boolean;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClose}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 transition',
          small ? 'py-2.5 text-[14px] text-ink-muted' : 'py-3 text-[15px] font-semibold text-ink',
          isActive ? 'bg-maroon-50 text-maroon-700' : 'hover:bg-maroon-50',
        )
      }
    >
      {Icon ? <Icon size={18} /> : null}
      {label}
    </NavLink>
  );
}
