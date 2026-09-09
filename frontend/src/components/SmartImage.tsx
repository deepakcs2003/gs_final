import { useMemo, useState } from 'react';
import clsx from 'clsx';

/**
 * Renders a product image, or a branded placeholder when there is no photo yet.
 *
 * Seed data uses the `gs-art:<palette>:<id>:<kind>` scheme instead of real URLs
 * so the whole site is browsable before the first photo shoot. Swap those for
 * Cloudinary URLs and this component starts serving real images with no other
 * change.
 */

const PALETTES: Array<{ from: string; to: string; accent: string; ink: string }> = [
  { from: '#7B1E3B', to: '#A83358', accent: '#E8A33D', ink: '#FDF8F0' },
  { from: '#E8A33D', to: '#F5C46B', accent: '#7B1E3B', ink: '#3A0B1B' },
  { from: '#1F6F43', to: '#3C9A68', accent: '#E8C46B', ink: '#F3FBF6' },
  { from: '#1E4F8F', to: '#3E7CC4', accent: '#EFD9A8', ink: '#F2F7FD' },
  { from: '#B0246B', to: '#DC5B95', accent: '#F5D98B', ink: '#FFF4F9' },
  { from: '#5B2483', to: '#8A4CB8', accent: '#F5C46B', ink: '#F9F3FD' },
];

interface ParsedArt {
  palette: (typeof PALETTES)[number];
  label: string;
  kind: string;
}

function parseArt(src: string): ParsedArt | null {
  if (!src.startsWith('gs-art:')) return null;
  const [, paletteRaw = '0', label = '', kind = 'front'] = src.split(':');
  const index = Number.parseInt(paletteRaw, 10);
  return {
    palette: PALETTES[Number.isFinite(index) ? Math.abs(index) % PALETTES.length : 0]!,
    label: label.toUpperCase(),
    kind,
  };
}

/** A stylised front-view blouse — enough to read as apparel at thumbnail size. */
const BLOUSE_PATH =
  'M30,24 Q40,26 44,24 Q50,38 56,24 Q60,26 70,24 L82,32 L78,46 L68,42 L70,76 L30,76 L32,42 L22,46 L18,32 Z';

function ArtPlaceholder({ art, className, rounded }: { art: ParsedArt; className?: string; rounded?: string }) {
  const { palette, label, kind } = art;
  const gradientId = useMemo(() => `g${Math.random().toString(36).slice(2, 9)}`, []);
  const isSwatch = kind === 'fabric' || kind === 'lace' || kind === 'latkan';

  return (
    <svg
      viewBox="0 0 100 133"
      className={clsx('h-full w-full', rounded, className)}
      role="img"
      aria-label={`${label} design preview`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
        <pattern id={`${gradientId}-weave`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0,4 H8 M4,0 V8" stroke={palette.accent} strokeWidth="0.9" opacity="0.35" />
        </pattern>
      </defs>

      <rect width="100" height="133" fill={`url(#${gradientId})`} />

      {/* Concentric rings echo a mandala without needing a real motif asset. */}
      <g opacity="0.16" stroke={palette.accent} fill="none">
        <circle cx="50" cy="58" r="34" strokeWidth="0.8" strokeDasharray="2 3" />
        <circle cx="50" cy="58" r="26" strokeWidth="0.6" />
        <circle cx="50" cy="58" r="42" strokeWidth="0.5" strokeDasharray="1 4" />
      </g>

      {isSwatch ? (
        <g transform="translate(20, 34)">
          <rect width="60" height="60" rx="6" fill={`url(#${gradientId}-weave)`} opacity="0.9" />
          <rect width="60" height="60" rx="6" fill="none" stroke={palette.accent} strokeWidth="1.2" opacity="0.7" />
        </g>
      ) : (
        <g transform="translate(0, 22)">
          <path d={BLOUSE_PATH} fill={palette.ink} opacity="0.16" />
          <path d={BLOUSE_PATH} fill="none" stroke={palette.ink} strokeWidth="1.1" opacity="0.55" />
          <path d="M44,24 Q50,38 56,24" fill="none" stroke={palette.accent} strokeWidth="1.4" />
          <path d="M30,72 H70" stroke={palette.accent} strokeWidth="1.2" opacity="0.8" />
        </g>
      )}

      <text
        x="50"
        y="120"
        textAnchor="middle"
        fill={palette.ink}
        opacity="0.85"
        fontSize="6.5"
        fontFamily="system-ui, sans-serif"
        fontWeight="600"
        letterSpacing="1.2"
      >
        {label}
      </text>
    </svg>
  );
}

interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Applied to both the <img> and the SVG fallback. */
  rounded?: string;
  /** Above-the-fold images skip lazy loading so the first paint has content. */
  eager?: boolean;
  sizes?: string;
}

export function SmartImage({ src, alt, className, rounded, eager, sizes }: SmartImageProps) {
  const [failed, setFailed] = useState(false);
  const art = parseArt(src);

  if (art || !src || failed) {
    const fallback = art ?? { palette: PALETTES[0]!, label: '', kind: 'front' };
    return <ArtPlaceholder art={fallback} className={className} rounded={rounded} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      sizes={sizes}
      className={clsx('h-full w-full object-cover', rounded, className)}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // A broken CDN URL falls back to the placeholder rather than a torn icon.
      onError={() => setFailed(true)}
    />
  );
}
