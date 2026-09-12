import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SmartImage } from '../SmartImage';

/**
 * Pinch / double-tap / drag zoom (README §8).
 *
 * Built on Pointer Events, which unifies touch, mouse and stylus — so the same
 * code handles a two-finger pinch on a phone and a wheel scroll on a desktop,
 * with no separate touch branch to keep in sync.
 *
 * Deliberate choices for a non-technical audience (§54):
 *  - double-tap toggles between fit and 2.5×, so zooming needs no instructions;
 *  - visible +, − and reset buttons exist for anyone who does not know pinch;
 *  - panning is clamped to the image, so it can never be lost off-screen.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

interface ZoomableImageProps {
  src: string;
  alt: string;
  aspectRatio?: number;
  onZoom?: () => void;
}

export function ZoomableImage({ src, alt, aspectRatio = 3 / 4, onZoom }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureStart = useRef<{ distance: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const lastTap = useRef(0);
  const zoomReported = useRef(false);

  // Reset when the customer switches to a different photo.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    zoomReported.current = false;
  }, [src]);

  /** Keeps the image within its frame — no panning into empty space. */
  const clampOffset = useCallback((next: { x: number; y: number }, atScale: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return next;
    const maxX = (rect.width * (atScale - 1)) / 2;
    const maxY = (rect.height * (atScale - 1)) / 2;
    return {
      x: Math.min(Math.max(next.x, -maxX), maxX),
      y: Math.min(Math.max(next.y, -maxY), maxY),
    };
  }, []);

  const applyScale = useCallback(
    (nextScale: number) => {
      const clamped = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
      setScale(clamped);
      setOffset((current) => (clamped === 1 ? { x: 0, y: 0 } : clampOffset(current, clamped)));

      // Report the first zoom of this image only — the admin's "image zoom
      // count" should measure interest, not count every pinch frame.
      if (clamped > 1 && !zoomReported.current) {
        zoomReported.current = true;
        onZoom?.();
      }
    },
    [clampOffset, onZoom],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gestureStart.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale };
      dragStart.current = null;
      return;
    }

    // Double tap / double click toggles zoom.
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      applyScale(scale > 1 ? 1 : DOUBLE_TAP_SCALE);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;

    if (scale > 1) {
      dragStart.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && gestureStart.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      applyScale((distance / gestureStart.current.distance) * gestureStart.current.scale);
      return;
    }

    if (dragStart.current && scale > 1) {
      setOffset(
        clampOffset(
          {
            x: dragStart.current.offsetX + (event.clientX - dragStart.current.x),
            y: dragStart.current.offsetY + (event.clientY - dragStart.current.y),
          },
          scale,
        ),
      );
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Only hijack the wheel once zoomed in, or with a deliberate ctrl+wheel.
    // Otherwise the page must stay scrollable.
    if (scale === 1 && !event.ctrlKey) return;
    event.preventDefault();
    applyScale(scale - event.deltaY * 0.003);
  };

  const zoomed = scale > 1;

  return (
    <div className="relative overflow-hidden rounded-xl2 bg-maroon-50">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
        className="w-full select-none"
        style={{
          aspectRatio,
          // Lets the browser handle vertical page scroll while unzoomed, then
          // hands us full control once the customer is inspecting the design.
          touchAction: zoomed ? 'none' : 'pan-y',
          cursor: zoomed ? 'grab' : 'zoom-in',
        }}
      >
        <div
          className="h-full w-full origin-center"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragStart.current || gestureStart.current ? 'none' : 'transform 180ms ease-out',
          }}
        >
          <SmartImage src={src} alt={alt} className="object-contain" eager sizes="(min-width: 1024px) 50vw, 100vw" />
        </div>
      </div>

      {/* Explicit controls — README §8 asks for these alongside the gestures. */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white/95 p-1 shadow-card backdrop-blur">
        <ZoomButton label="Zoom out" onClick={() => applyScale(scale - 0.5)} disabled={scale <= MIN_SCALE}>
          <ZoomOut size={18} />
        </ZoomButton>
        <span className="min-w-[42px] text-center text-[12px] font-bold text-ink-muted">{scale.toFixed(1)}×</span>
        <ZoomButton label="Zoom in" onClick={() => applyScale(scale + 0.5)} disabled={scale >= MAX_SCALE}>
          <ZoomIn size={18} />
        </ZoomButton>
        <ZoomButton label="Reset" onClick={() => applyScale(1)} disabled={scale === 1}>
          <RotateCcw size={16} />
        </ZoomButton>
      </div>

      {!zoomed ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1.5 text-[11.5px] font-medium text-white">
          Zoom karne ke liye do baar tap karein
        </p>
      ) : null}
    </div>
  );
}

function ZoomButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-full text-ink transition hover:bg-maroon-50 disabled:opacity-35"
    >
      {children}
    </button>
  );
}
