import { useEffect, useRef } from 'react';

/**
 * Infinite scroll trigger (README §5 — no "See More" button).
 *
 * An IntersectionObserver fires while the sentinel is still 400px below the
 * fold, so the next page is usually already in place by the time the customer
 * reaches it and the scroll never visibly stalls.
 */

interface InfiniteSentinelProps {
  onVisible: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function InfiniteSentinel({ onVisible, disabled, loading }: InfiniteSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    const node = ref.current;
    if (!node || disabled) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) callback.current();
      },
      { rootMargin: '400px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled]);

  return (
    <div ref={ref} className="flex justify-center py-8" aria-hidden={!loading}>
      {loading ? (
        <span className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-maroon-200 border-t-maroon-600" />
          Aur designs aa rahe hain…
        </span>
      ) : null}
    </div>
  );
}
