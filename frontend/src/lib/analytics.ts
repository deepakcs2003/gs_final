import { api, getSessionId } from './api';

/**
 * Client half of the event system (README §76–77).
 *
 * Events are queued and flushed in batches — on a timer, and always on page
 * hide, which is the only moment a browser reliably gives you before the tab
 * closes. Nothing here ever blocks a click or a navigation.
 */

export type EventType =
  | 'PAGE_VIEW'
  | 'PRODUCT_VIEW'
  | 'PRODUCT_VIEW_END'
  | 'PRODUCT_IMAGE_VIEW'
  | 'IMAGE_ZOOM'
  | 'SEARCH'
  | 'CATEGORY_VIEW'
  | 'WISHLIST_ADD'
  | 'WISHLIST_REMOVE'
  | 'CART_ADD'
  | 'CART_REMOVE'
  | 'BUY_NOW'
  | 'CHECKOUT_START'
  | 'CHECKOUT_BACK'
  | 'CHECKOUT_CANCEL'
  | 'CHECKOUT_ABANDON'
  | 'MEASUREMENT_START'
  | 'MEASUREMENT_COMPLETE'
  | 'WHATSAPP_CLICK'
  | 'SHARE'
  | 'ORDER_PLACED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED';

interface QueuedEvent {
  type: EventType;
  sessionId: string;
  productId?: string | null;
  path: string;
  referrer: string;
  query?: string;
  durationMs?: number;
  value?: number;
  utm?: { source: string; medium: string; campaign: string };
  device?: { type: string; os: string; browser: string; screen: string };
}

const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 8000;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function readUtm() {
  const params = new URLSearchParams(window.location.search);
  return {
    source: (params.get('utm_source') ?? '').slice(0, 60),
    medium: (params.get('utm_medium') ?? '').slice(0, 60),
    campaign: (params.get('utm_campaign') ?? '').slice(0, 60),
  };
}

/** Coarse device facts for the admin's visitor report (README §37). */
function readDevice() {
  const ua = navigator.userAgent;
  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile = !isTablet && /Mobi|Android|iPhone/i.test(ua);

  let os = 'Other';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return {
    type: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
    os,
    browser,
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

export function track(type: EventType, payload: Partial<QueuedEvent> = {}): void {
  queue.push({
    type,
    sessionId: getSessionId(),
    path: window.location.pathname.slice(0, 300),
    referrer: document.referrer.slice(0, 300),
    utm: readUtm(),
    device: readDevice(),
    ...payload,
  });

  if (queue.length >= MAX_BATCH) {
    void flush();
    return;
  }

  timer ??= setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
}

export async function flush(useBeacon = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;

  const events = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  const body = JSON.stringify({ events });

  // sendBeacon survives the page unloading; fetch usually does not. It cannot
  // carry the CSRF header, so this path is only used on unload where losing a
  // few events is preferable to losing them all.
  if (useBeacon && navigator.sendBeacon) {
    try {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      return;
    } catch {
      /* fall through to fetch */
    }
  }

  try {
    await api('/events', { method: 'POST', body: { events }, quiet: true });
  } catch {
    // Analytics must never surface an error to a shopper.
  }
}

let started = false;

export function startAnalytics(): void {
  if (started) return;
  started = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
  window.addEventListener('pagehide', () => void flush(true));
}

/**
 * Times how long a product page was actually looked at (README §77). Returns a
 * stop function; call it on unmount.
 */
export function trackProductView(productId: string): () => void {
  const startedAt = Date.now();
  track('PRODUCT_VIEW', { productId });

  return () => {
    const durationMs = Date.now() - startedAt;
    // Under a second is a bounce, not a view — recording it would drag the
    // average down and make the "time on design" report useless.
    if (durationMs >= 1000) {
      track('PRODUCT_VIEW_END', { productId, durationMs: Math.min(durationMs, 6 * 60 * 60 * 1000) });
    }
  };
}
