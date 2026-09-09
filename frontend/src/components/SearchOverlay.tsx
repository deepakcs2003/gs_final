import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Search, X, TrendingUp } from 'lucide-react';
import { SmartImage } from './SmartImage';
import { Price } from './ui';
import { useConfig, useSearch } from '../hooks/queries';
import { useUi } from '../store/ui';
import { track } from '../lib/analytics';

/**
 * Search (README §31). Matches name, design id, category, colour, fabric and
 * embroidery server-side; this is just the surface.
 */

const SUGGESTIONS = ['bridal blouse', 'silk blouse', 'designer blouse', 'red blouse', 'sleeveless', 'GS-206'];

export function SearchOverlay() {
  const open = useUi((state) => state.searchOpen);
  const close = useUi((state) => state.closeSearch);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: config } = useConfig();

  // Debounce so a fast typist doesn't fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 280);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (debounced.length >= 2) track('SEARCH', { query: debounced });
  }, [debounced]);

  const { data: results, isFetching } = useSearch(debounced, open);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-cream">
      <div className="flex items-center gap-2 border-b border-maroon-100 bg-white px-3 py-2.5">
        <div className="relative flex-1">
          <Search size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
          <input
            ref={inputRef}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Blouse design, color ya GS-206 likhein…"
            className="field pl-10"
            // 16px font size prevents iOS Safari zooming in on focus.
            style={{ fontSize: 16 }}
            aria-label="Search designs"
            maxLength={80}
          />
        </div>
        <button
          type="button"
          onClick={close}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-maroon-50"
          aria-label="Search band karein"
        >
          <X size={21} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {debounced.length < 2 ? (
          <section className="mx-auto max-w-2xl">
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-ink-muted">
              <TrendingUp size={15} />
              Popular searches
            </h3>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setTerm(suggestion)} className="chip">
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
        ) : isFetching ? (
          <div className="mx-auto max-w-2xl space-y-2.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="skeleton h-20 rounded-xl2" />
            ))}
          </div>
        ) : !results || results.length === 0 ? (
          <p className="mt-16 text-center text-[15px] text-ink-muted">
            "{debounced}" ke liye kuch nahi mila.
            <br />
            Doosre shabd try karein.
          </p>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-2">
            {results.map((product) => (
              <li key={product.id}>
                <Link
                  to={`/blouse/${product.slug}`}
                  onClick={close}
                  className="flex items-center gap-3 rounded-xl2 bg-white p-2.5 shadow-card transition hover:shadow-lift"
                >
                  <span className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-maroon-50">
                    <SmartImage src={product.image} alt={product.imageAlt} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{product.name}</span>
                    <span className="block text-[12px] text-ink-muted">{product.designId}</span>
                    {product.type !== 'SHOWCASE' ? (
                      <Price price={product.price} currency={config?.currency ?? 'INR'} size="sm" />
                    ) : (
                      <span className="text-[12px] font-semibold text-marigold-700">Coming Soon</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
