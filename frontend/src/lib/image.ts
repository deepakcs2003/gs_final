/**
 * Client-side Cloudinary URL resizing.
 *
 * The server already serves product/banner/fabric images through
 * `f_auto,q_auto,w_<N>,c_limit` so browsers get format + quality optimised
 * files. Every now and then a URL still arrives at its original resolution
 * (measurement guides, admin previews, seeded data), so this helper rebuilds a
 * Cloudinary URL at a target width while keeping the same delivery options.
 *
 * Safety rules:
 *  - Non-Cloudinary URLs (seeded `gs-art:` schemes, external hosts) pass through
 *    untouched — nothing here ever breaks or rewrites non-CDN images.
 *  - `c_limit` never upscales, so asking for a larger width is always safe.
 *     - `f_auto`/`q_auto` are left as-is when already present; injected only
 *       when the original URL had no delivery options at all.
 */
const CLOUDINARY_MARKER = '/upload/';

/** Returns the target width currently baked into a Cloudinary URL, if any. */
function encodedWidth(url: string): number | null {
  const transformSegment = transformOf(url);
  const match = transformSegment?.match(/w_(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** The delivery-options block just after `/upload/` (or null if none). */
function transformOf(url: string): string | null {
  const at = url.indexOf(CLOUDINARY_MARKER);
  if (at === -1) return null;
  const tail = url.slice(at + CLOUDINARY_MARKER.length);
  const rest = tail.split('/', 1)[0];
  return rest || null;
}

/** Rebuilds a Cloudinary URL at `width`. Non-Cloudinary URLs pass through. */
export function cloudinarySrc(src: string, width: number): string {
  const at = src.indexOf(CLOUDINARY_MARKER);
  if (at === -1) return src;

  const head = src.slice(0, at + CLOUDINARY_MARKER.length);
  const tail = src.slice(at + CLOUDINARY_MARKER.length);
  const slash = tail.indexOf('/');
  const segment = slash === -1 ? tail : tail.slice(0, slash);
  const rest = slash === -1 ? '' : `/${tail.slice(slash + 1)}`;
  const target = Math.max(16, Math.round(width));

  if (/w_\d+/.test(segment)) {
    return `${head}${segment.replace(/w_\d+/, `w_${target}`)}${rest}`;
  }

  // A transform block (comma-separated options) that had no explicit width.
  if (segment.includes(',')) {
    return `${head}w_${target},${segment}${rest}`;
  }

  // Raw delivery path (version `v…` or public id) — prepend a full transform.
  return `${head}w_${target},c_limit,f_auto,q_auto/${segment}${rest}`;
}

/**
 * Responsive `srcSet` string derived from a Cloudinary URL, or '' for
 * non-Cloudinary sources (SmartImage then simply keeps the single `src`).
 *
 * Widths step down from whatever the URL already encodes (600/900/…); the
 * largest entry is exactly the encoded width so the browser can never pick a
 * larger image than the page used before — only a smaller one.
 */
export function responsiveSrcSet(src: string): string {
  if (src.indexOf(CLOUDINARY_MARKER) === -1) return '';
  const base = encodedWidth(src) ?? 600;
  if (base < 64) return '';
  const half = Math.round(base * 0.5);
  const widths = half === base ? [base] : [half, base];
  return widths.map((w) => `${cloudinarySrc(src, w)} ${w}w`).join(', ');
}