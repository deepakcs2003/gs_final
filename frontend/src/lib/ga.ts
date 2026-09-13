declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

export function getMeasurementId(): string {
  return (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();
}

export function initGA4(): void {
  if (typeof window === 'undefined') return;

  const measurementId = getMeasurementId();
  if (!measurementId || !measurementId.startsWith('G-')) return;

  window.dataLayer = window.dataLayer ?? [];

  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
  }

  if (!document.querySelector('script[data-ga4-loader="true"]')) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.setAttribute('data-ga4-loader', 'true');
    document.head.appendChild(script);
  }

  window.gtag?.('js', new Date());
  window.gtag?.('config', measurementId, { send_page_view: false });
}

export function trackPageView(path: string, search = ''): void {
  const measurementId = getMeasurementId();
  if (!measurementId || !window.gtag) return;

  window.gtag('event', 'page_view', {
    page_location: `${window.location.origin}${path}${search}`,
    page_path: path,
    page_title: document.title || 'Guddi Silai',
  });
}
