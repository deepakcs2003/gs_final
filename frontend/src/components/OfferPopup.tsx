import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, Tag, X } from 'lucide-react';
import { Badge, Price } from './ui';
import { SmartImage } from './SmartImage';
import { useOfferPopup } from '../hooks/queries';
import type { OfferPopup as OfferPopupData } from '../lib/types';

const SNAP_KEY = 'gs-popup-snapshot';
const STATE_KEY = 'gs-popup-state';

interface SessionState {
  status: 'shown' | 'dismissed' | null;
  snapshot: OfferPopupData | null;
}

/**
 * Promotional popup (README §85.14).
 *
 * Session rules — exactly one popup per browsing session:
 *  - The first eligible popup the API returns is *reserved* for this session
 *    (snapshotted into sessionStorage). The backend serves a random eligible
 *    campaign per request, so different sessions see different offers.
 *  - Once the popup has appeared (or has been closed) the session is flagged;
 *    refreshing or navigating never brings up another popup.
 *  - Expired (endsAt passed) or disabled campaigns are ignored — an expired
 *    reserved popup is cleared instead of being shown.
 *  - The popup appears only after the admin-configured delay (never instantly),
 *    shows a live countdown for limited-time offers, and every CTA drops into
 *    the existing product flow (Ready-Made or Customize) — no new pages.
 */
function readSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(SNAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const status = sessionStorage.getItem(STATE_KEY) as SessionState['status'];
    return {
      status,
      snapshot: parsed && typeof parsed === 'object' ? (parsed.popup ?? null) : null,
    };
  } catch {
    return { status: null, snapshot: null };
  }
}

export function OfferPopupHost() {
  const { data } = useOfferPopup();
  const [session] = useState<SessionState>(readSession);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A popup already reserved for this session wins over whatever the API
  // returns now (server picks randomly per request).
  const popup = useMemo<OfferPopupData | null>(() => session.snapshot ?? data?.popup ?? null, [session.snapshot, data?.popup]);

  useEffect(() => {
    if (!popup) return;
    if (session.status) return; // already shown/dismissed → no more popups this session
    if (new Date(popup.endsAt ?? '').getTime() > 0 && new Date(popup.endsAt as string).getTime() <= Date.now()) {
      sessionStorage.removeItem(SNAP_KEY); // expired reservation → drop it
      return;
    }
    if (!session.snapshot) {
      sessionStorage.setItem(SNAP_KEY, JSON.stringify({ popup }));
    }
    const timer = window.setTimeout(() => {
      setVisible(true);
      sessionStorage.setItem(STATE_KEY, 'shown');
    }, Math.max(5000, popup.delaySeconds * 1000));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.id]);

  // Live countdown for limited-time offers.
  useEffect(() => {
    if (!visible || !popup?.limited || !popup.endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, popup?.id]);

  if (!popup || !visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(STATE_KEY, 'dismissed');
    sessionStorage.removeItem(SNAP_KEY);
    setVisible(false);
  };

  const expired = Boolean(popup.limited && popup.endsAt && new Date(popup.endsAt).getTime() <= now);

  // The offer ran out while the popup was open — close it and respect the
  // one-popup-per-session rule instead of swapping in another campaign.
  useEffect(() => {
    if (visible && expired) {
      sessionStorage.setItem(STATE_KEY, 'dismissed');
      sessionStorage.removeItem(SNAP_KEY);
      setVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expired]);

  const remainingMs = Math.max(0, new Date(popup.endsAt ?? 0).getTime() - now);

  const seconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const countdownLabel = days > 0
    ? `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const isFree = popup.offerType === 'free';
  const cta = isFree
    ? popup.product.type === 'CUSTOMIZE'
      ? 'Customize & Get Free'
      : 'Claim Free Blouse'
    : popup.product.type === 'CUSTOMIZE'
      ? 'Customize Now'
      : popup.product.type === 'SHOWCASE'
        ? 'Shop Now'
        : 'Buy Now';

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={dismiss}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl2 bg-white shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[16/9] overflow-hidden bg-maroon-50">
          {popup.product.image ? (
            <SmartImage src={popup.product.image} alt={popup.product.name} className="absolute inset-0 h-full w-full object-cover" sizes="384px" />
          ) : (
            <span className="absolute inset-0 grid place-items-center bg-maroon-100 text-[13px] font-bold text-maroon-700">
              {popup.product.designId}
            </span>
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />

          <button
            type="button"
            onClick={dismiss}
            aria-label="Popup band karein"
            className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full bg-ink/60 text-white backdrop-blur transition hover:bg-ink/80"
          >
            <X size={16} />
          </button>

          <span className="absolute bottom-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
            {isFree || popup.product.price.priceMinor === 0 ? (
              <Badge tone="accent">FREE</Badge>
            ) : (
              <Badge tone="accent">
                {popup.product.price.discountPercent > 0
                  ? `Flat ${popup.product.price.discountPercent}% OFF`
                  : 'Special Offer'}
              </Badge>
            )}
            {popup.limited ? <Badge tone="dark">Limited time</Badge> : null}
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="relative flex items-start justify-center gap-1.5 text-center">
            <span className="mt-1 text-maroon-700">
              {isFree ? <Gift size={18} /> : <Tag size={18} />}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[17px] font-bold leading-tight text-ink">{popup.product.name}</h3>
              {popup.headline ? <p className="mt-0.5 truncate text-[13px] text-maroon-700">{popup.headline}</p> : null}
            </div>
          </div>

          {isFree ? (
            <p className="text-center text-[13px] font-semibold text-ink-muted">
              Is blouse par FREE offer — bas order karein.
            </p>
          ) : (
            <div className="flex items-center justify-center gap-2.5">
              <Price price={popup.product.price} currency={popup.product.price.currency} />
            </div>
          )}

          {popup.limited && popup.endsAt ? (
            <div className="flex items-center justify-center gap-2 rounded-full border border-marigold-300 bg-marigold-100/70 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink">Ends in {countdownLabel}</span>
            </div>
          ) : null}

          <Link
            to={`/blouse/${popup.product.slug}`}
            onClick={dismiss}
            className="block w-full rounded-full bg-gradient-to-r from-maroon-700 to-maroon-600 py-2.5 text-center text-[14px] font-bold text-white shadow-lift transition hover:from-maroon-800 hover:to-maroon-700"
          >
            {cta}
          </Link>
        </div>
      </div>
    </div>
  );
}