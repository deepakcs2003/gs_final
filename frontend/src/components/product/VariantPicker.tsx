import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Sheet } from '../ui';
import { useProduct } from '../../hooks/queries';
import type { ProductCard as ProductCardType, ProductDetail } from '../../lib/types';

/**
 * Colour + size picker (README §11).
 *
 * The availability matrix comes from the product detail endpoint, so a
 * combination that is genuinely out of stock is struck through rather than
 * silently failing at checkout. Size buttons are 48px so they are easy to hit
 * with a thumb.
 */

interface VariantPickerProps {
  open: boolean;
  onClose: () => void;
  product: ProductCardType;
  actionLabel: string;
  onConfirm: (selection: { colorSlug: string; size: number; quantity: number; detail: ProductDetail }) => void;
}

export function VariantPicker({ open, onClose, product, actionLabel, onConfirm }: VariantPickerProps) {
  const { data: detail, isLoading } = useProduct(open ? product.slug : undefined);
  const [colorSlug, setColorSlug] = useState<string>('');
  const [size, setSize] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  const colors = detail?.colors ?? product.colors;
  const sizes = detail?.sizes ?? product.sizes;
  const activeColor = colorSlug || colors[0]?.slug || '';

  /** Sizes available in the currently selected colour. */
  const sizeStatus = useMemo(() => {
    const map = new Map<number, { available: boolean; lowStock: number | null }>();
    for (const cell of detail?.availability ?? []) {
      if (cell.colorSlug !== activeColor) continue;
      map.set(cell.size, { available: cell.available, lowStock: cell.lowStock });
    }
    return map;
  }, [detail, activeColor]);

  const selectedStatus = size !== null ? sizeStatus.get(size) : undefined;
  const canConfirm = Boolean(detail) && Boolean(activeColor) && size !== null && selectedStatus?.available !== false;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product.name}
      subtitle="Color aur size choose karein"
      footer={
        <button
          type="button"
          className="btn-primary btn-lg w-full"
          disabled={!canConfirm}
          onClick={() => {
            if (!detail || size === null) return;
            onConfirm({ colorSlug: activeColor, size, quantity, detail });
          }}
        >
          {canConfirm ? actionLabel : size === null ? 'Size choose karein' : 'Yeh size available nahi'}
        </button>
      }
    >
      {isLoading ? (
        <div className="space-y-4 py-2">
          <div className="skeleton h-5 w-24 rounded" />
          <div className="skeleton h-12 w-full rounded-xl" />
          <div className="skeleton h-12 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6 py-1">
          {/* Colour */}
          <section>
            <h3 className="label">
              Color <span className="font-normal text-ink-muted">— {colors.find((c) => c.slug === activeColor)?.name}</span>
            </h3>
            <div className="flex flex-wrap gap-2.5">
              {colors.map((color) => {
                const isActive = color.slug === activeColor;
                return (
                  <button
                    key={color.slug}
                    type="button"
                    aria-label={color.name}
                    aria-pressed={isActive}
                    onClick={() => {
                      setColorSlug(color.slug);
                      setSize(null);
                    }}
                    className={clsx(
                      'flex h-12 items-center gap-2 rounded-xl border-2 px-3 transition',
                      isActive ? 'border-maroon-600 bg-maroon-50' : 'border-ink-light/25 bg-white',
                    )}
                  >
                    <span
                      className="h-6 w-6 rounded-full border border-ink-light/40"
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="text-sm font-semibold">{color.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Size */}
          <section>
            <h3 className="label">Size</h3>
            <div className="flex flex-wrap gap-2.5">
              {sizes.map((value) => {
                const status = sizeStatus.get(value);
                const unavailable = status?.available === false;
                const isActive = size === value;

                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={isActive}
                    disabled={unavailable}
                    onClick={() => setSize(value)}
                    className={clsx(
                      'relative h-12 min-w-[56px] rounded-xl border-2 text-base font-bold transition',
                      unavailable && 'cursor-not-allowed border-ink-light/20 bg-maroon-50/40 text-ink-light',
                      !unavailable && isActive && 'border-maroon-600 bg-maroon-600 text-white',
                      !unavailable && !isActive && 'border-ink-light/25 bg-white text-ink',
                    )}
                  >
                    {value}
                    {unavailable ? (
                      <span className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="h-[1.5px] w-9 rotate-[-20deg] bg-ink-light/70" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectedStatus?.available === false ? (
              <p className="mt-2 text-sm font-medium text-alert">Yeh color aur size abhi out of stock hai.</p>
            ) : null}
            {selectedStatus?.lowStock ? (
              <p className="mt-2 text-sm font-medium text-marigold-700">
                Sirf {selectedStatus.lowStock} bache hain — jaldi order karein.
              </p>
            ) : null}
          </section>

          {/* Quantity */}
          <section>
            <h3 className="label">Kitne chahiye?</h3>
            <div className="inline-flex items-center gap-1 rounded-xl border border-ink-light/25 bg-white p-1">
              <button
                type="button"
                aria-label="Kam karein"
                className="h-10 w-10 rounded-lg text-xl font-bold text-maroon-700 disabled:opacity-40"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="w-10 text-center text-base font-bold">{quantity}</span>
              <button
                type="button"
                aria-label="Zyada karein"
                className="h-10 w-10 rounded-lg text-xl font-bold text-maroon-700 disabled:opacity-40"
                disabled={quantity >= 10}
                onClick={() => setQuantity((q) => Math.min(10, q + 1))}
              >
                +
              </button>
            </div>
          </section>
        </div>
      )}
    </Sheet>
  );
}
