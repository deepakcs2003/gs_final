import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Star, Check, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import { useUi } from '../store/ui';
import { formatMoney, type Currency } from '../lib/format';

/* -------------------------------------------------------------------------- */
/* Sheet — bottom sheet on phones, centred dialog on wide screens              */
/* -------------------------------------------------------------------------- */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Sticky action row pinned to the bottom of the sheet. */
  footer?: ReactNode;
  maxWidth?: string;
}

export function Sheet({ open, onClose, title, subtitle, children, footer, maxWidth = 'sm:max-w-lg' }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    // Locking the body prevents the page behind scrolling under the sheet —
    // the single most common annoyance with mobile overlays.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    // Move focus into the sheet so screen readers and keyboards follow along.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Band karein"
        className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-sheet',
          'animate-slide-up sm:rounded-3xl sm:animate-fade-in',
          maxWidth,
        )}
      >
        {/* Drag affordance — signals "swipe/tap to dismiss" without words. */}
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-ink-light/30 sm:hidden" />

        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
            {subtitle ? <p className="hint mt-0.5">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Band karein"
            className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-maroon-50"
          >
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>

        {footer ? (
          <div className="border-t border-ink-light/15 bg-white px-5 pb-safe pt-3 sm:rounded-b-3xl">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Toaster                                                                     */
/* -------------------------------------------------------------------------- */

const TOAST_ICON = { success: Check, error: AlertCircle, info: Info } as const;
const TOAST_TONE = {
  success: 'bg-leaf text-white',
  error: 'bg-alert text-white',
  info: 'bg-ink text-white',
} as const;

export function Toaster() {
  const toasts = useUi((state) => state.toasts);
  const dismiss = useUi((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottomnav-h)+var(--safe-bottom)+12px)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.tone];
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={clsx(
              'pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl px-4 py-3 text-left',
              'text-sm font-medium shadow-lift animate-slide-up',
              TOAST_TONE[toast.tone],
            )}
          >
            <Icon size={18} className="shrink-0" />
            <span className="flex-1">{toast.message}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Small display primitives                                                    */
/* -------------------------------------------------------------------------- */

export function Stars({ value, count, size = 13 }: { value: number; count?: number; size?: number }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink">
      <Star size={size} className="fill-marigold-500 text-marigold-500" />
      {value.toFixed(1)}
      {count !== undefined && count > 0 ? <span className="font-normal text-ink-muted">({count})</span> : null}
    </span>
  );
}

export function ColorDots({ colors, max = 4 }: { colors: Array<{ name: string; hex: string }>; max?: number }) {
  if (colors.length === 0) return null;
  const shown = colors.slice(0, max);
  const extra = colors.length - shown.length;

  return (
    <span className="inline-flex items-center gap-1" aria-label={`Colours: ${colors.map((c) => c.name).join(', ')}`}>
      {shown.map((color) => (
        <span
          key={color.hex + color.name}
          title={color.name}
          className="h-3.5 w-3.5 rounded-full border border-ink-light/40"
          style={{ backgroundColor: color.hex }}
        />
      ))}
      {extra > 0 ? <span className="text-[11px] font-medium text-ink-muted">+{extra}</span> : null}
    </span>
  );
}

export function Price({
  price,
  currency,
  size = 'md',
  couponOffer,
}: {
  price: { priceMinor: number; mrpMinor: number; discountPercent: number };
  currency: Currency;
  size?: 'sm' | 'md' | 'lg';
  couponOffer?: { code: string; description: string; finalPriceMinor: number; discountMinor: number; savingsPercent: number };
}) {
  const sizes = {
    sm: { main: 'text-[15px]', rest: 'text-[11px]' },
    md: { main: 'text-[17px]', rest: 'text-xs' },
    lg: { main: 'text-2xl', rest: 'text-sm' },
  }[size];

  const hasRealDiscount = couponOffer ? couponOffer.finalPriceMinor < price.priceMinor : false;

  // Main row always shows the product's REAL selling price + MRP + % OFF.
  // The coupon (e.g. "Get at ₹749 with INSTA25") is its own separate line below
  // and must NEVER overwrite the selling price.
  // Zero-priced products read as FREE everywhere — never ₹0 (global rule).
  const isFree = price.priceMinor === 0;

  return (
    <span className="flex w-full min-w-0 flex-col items-start gap-1">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {isFree ? (
          <span className={clsx('font-black uppercase tracking-wide text-leaf', sizes.main)}>FREE</span>
        ) : (
          <>
            <span className={clsx('font-bold text-ink', sizes.main)}>{formatMoney(price.priceMinor, currency)}</span>
            {price.discountPercent > 0 ? (
              <>
                <span className={clsx('text-ink-light line-through', sizes.rest)}>
                  {formatMoney(price.mrpMinor, currency)}
                </span>
                <span className={clsx('font-bold text-leaf', sizes.rest)}>{price.discountPercent}% OFF</span>
              </>
            ) : null}
          </>
        )}
      </span>

      {couponOffer && hasRealDiscount ? (
        <span className={clsx('inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 text-[11px] font-semibold text-leaf', sizes.rest)}>
          <span>Get at</span>
          <span className="font-bold text-leaf">{formatMoney(couponOffer.finalPriceMinor, currency)}</span>
          <span>with</span>
          <span className="rounded-full bg-leaf/10 px-1.5 py-0.5 font-bold text-leaf">{couponOffer.code}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Badge({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'dark' | 'alert' | 'leaf' }) {
  const tones = {
    accent: 'bg-marigold-500 text-ink',
    dark: 'bg-ink/85 text-white',
    alert: 'bg-alert text-white',
    leaf: 'bg-leaf text-white',
  };
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide', tones[tone])}>{children}</span>
  );
}

export function CardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-[3/4] w-full" />
      <div className="space-y-2 p-3">
        <div className="skeleton h-3.5 w-4/5 rounded" />
        <div className="skeleton h-4 w-1/2 rounded" />
        <div className="skeleton h-8 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-maroon-50 text-maroon-500">{icon}</div>
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="hint mt-1.5 max-w-xs">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
