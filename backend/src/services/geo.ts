import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { COD_COUNTRIES, INR_COUNTRIES, type Currency } from '../domain/constants.js';

/**
 * Coarse geo, taken from the CDN/edge headers that already sit in front of the
 * API. We deliberately do not run an IP-to-city database on raw addresses: the
 * README's own privacy note (§63) and Indian DPDP practice both point at
 * collecting the minimum. Country is enough to price correctly; state/city are
 * only recorded when the edge already resolved them.
 */

const COUNTRY_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'x-appengine-country', // Google
  'x-geo-country',
] as const;

const STATE_HEADERS = ['x-vercel-ip-country-region', 'x-appengine-region', 'x-geo-region'] as const;
const CITY_HEADERS = ['x-vercel-ip-city', 'x-appengine-city', 'x-geo-city'] as const;

const COUNTRY_RE = /^[A-Z]{2}$/;

function readHeader(req: Request, names: readonly string[], maxLength: number): string {
  for (const name of names) {
    const raw = req.get(name);
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= maxLength) {
      // Strip anything that isn't a plain place name before it reaches a log or
      // the database.
      const cleaned = decodeURIComponent(raw).replace(/[^\p{L}\p{N} .,'-]/gu, '').trim();
      if (cleaned) return cleaned.slice(0, maxLength);
    }
  }
  return '';
}

export interface GeoContext {
  country: string;
  state: string;
  city: string;
  currency: Currency;
  codAllowed: boolean;
}

export function resolveGeo(req: Request): GeoContext {
  const rawCountry = readHeader(req, COUNTRY_HEADERS, 2).toUpperCase();
  // Default to India: it is the home market, and an unknown visitor priced in
  // rupees is a far smaller problem than one wrongly denied COD.
  const country = COUNTRY_RE.test(rawCountry) && rawCountry !== 'XX' ? rawCountry : 'IN';

  return {
    country,
    state: readHeader(req, STATE_HEADERS, 60),
    city: readHeader(req, CITY_HEADERS, 60),
    currency: currencyForCountry(country),
    codAllowed: isCodAllowed(country),
  };
}

/** README §32 — the subcontinent is billed in rupees, everyone else in dollars. */
export function currencyForCountry(country: string): Currency {
  return (INR_COUNTRIES as readonly string[]).includes(country.toUpperCase()) ? 'INR' : 'USD';
}

/** README §32 — no cash on delivery for foreign buyers. */
export function isCodAllowed(country: string): boolean {
  return (COD_COUNTRIES as readonly string[]).includes(country.toUpperCase());
}

/**
 * One-way, salted hash of the caller's IP for unique-visitor counting. The raw
 * address is never persisted, and the salt makes the hashes useless outside
 * this deployment.
 */
export function hashIp(ip: string | undefined): string {
  if (!ip) return '';
  return crypto.createHmac('sha256', env.CSRF_SECRET).update(ip).digest('hex').slice(0, 32);
}

/** Normalises a referrer into an acquisition channel (README §37). */
export function classifySource(referrer: string, utmSource: string): string {
  const utm = utmSource.trim().toLowerCase();
  if (utm) return utm.slice(0, 40);
  if (!referrer) return 'direct';

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'direct';
  }

  if (host.includes('google.')) return 'google';
  if (host.includes('instagram.')) return 'instagram';
  if (host.includes('facebook.') || host.includes('fb.')) return 'facebook';
  if (host.includes('whatsapp.') || host.includes('wa.me')) return 'whatsapp';
  if (host.includes('youtube.')) return 'youtube';
  if (host.includes('pinterest.')) return 'pinterest';
  return 'referral';
}
