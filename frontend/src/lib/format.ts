export type Currency = 'INR' | 'USD';

/**
 * Money arrives from the API in minor units (paise / cents) as integers, which
 * is what keeps totals exact. Formatting is the only place it becomes a decimal.
 */
export function formatMoney(minor: number, currency: Currency): string {
  const value = minor / 100;

  if (currency === 'INR') {
    // Indian grouping (1,23,456) — `en-IN` gets this right, `en-US` does not.
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Centralized "FREE vs price" label (global zero-price rule): any amount that
 * is 0 renders as FREE instead of ₹0/$0 — used everywhere a single product or
 * line-item price is shown. Totals stay as formatted amounts; this helper is
 * for *product* prices, popups, materials, cart/order lines, etc.
 */
export function moneyLabel(minor: number, currency: Currency): string {
  return minor === 0 ? 'FREE' : formatMoney(minor, currency);
}

export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function pluralHi(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Builds the WhatsApp enquiry deep link (README §24). The product link is
 * derived from the live URL so a shared design always opens the right page.
 */
export function whatsappEnquiryUrl(params: {
  number: string;
  productName?: string;
  designId?: string;
  category?: string;
  url?: string;
}): string {
  const lines = ['Hello Guddi Silai 🌸', 'Mujhe ye blouse design pasand hai.'];

  if (params.productName) lines.push(`Design: ${params.productName}`);
  if (params.designId) lines.push(`Design ID: ${params.designId}`);
  if (params.category) lines.push(`Category: ${params.category}`);
  if (params.url) lines.push(`Link: ${params.url}`);

  lines.push('Please price, stitching details aur availability bataiye.', 'Thank you.');

  return `https://wa.me/${params.number}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/** A short, human label for a product type — used on badges and filters. */
export const TYPE_LABEL: Record<string, string> = {
  READY_MADE: 'Ready to Buy',
  CUSTOMIZE: 'Customize',
  SHOWCASE: 'Showcase',
};
