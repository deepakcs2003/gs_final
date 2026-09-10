import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartLine, MeasurementData, ProductCard, ProductDetail } from '../lib/types';
import { track } from '../lib/analytics';

/**
 * The cart lives in the browser so a guest can shop without an account
 * (README §2). It stores *choices only* — never a price. Totals come from
 * POST /api/cart/quote, which recomputes everything server-side.
 *
 * localStorage is the right home for this: it is not a secret, it must survive
 * a refresh, and losing it in private mode is merely inconvenient.
 */

interface AddLineInput {
  product: ProductCard | ProductDetail;
  quantity?: number;
  colorSlug?: string;
  size?: number | null;
  fabricId?: string | null;
  fabricIds?: string[];
  fabricName?: string;
  laceIds?: string[];
  laceColors?: Array<{ id: string; colorName: string; colorHex?: string }>;
  latkanIds?: string[];
  latkanColors?: Array<{ id: string; colorName: string; colorHex?: string }>;
  laceName?: string;
  latkanName?: string;
  measurement?: MeasurementData | null;
  note?: string;
}

interface CartState {
  lines: CartLine[];
  appliedCoupon: string;
  add: (input: AddLineInput) => string;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  setMeasurement: (key: string, measurement: MeasurementData) => void;
  setNote: (key: string, note: string) => void;
  setAppliedCoupon: (coupon: string) => void;
  clear: () => void;
  count: () => number;
  find: (key: string) => CartLine | undefined;
}

function makeKey(input: AddLineInput): string {
  // Identity of a line is its full configuration, so re-adding the same colour
  // and size bumps quantity rather than creating a duplicate row. A custom line
  // gets a unique suffix because two of them can differ by measurement alone.
  if (input.product.type === 'CUSTOMIZE') {
    // Keep this below the API's 64-character key limit. Custom lines are
    // intentionally unique, so the product/fabric/lace ids do not need to be
    // embedded in the key itself.
    return `${input.product.id}|custom|${Math.random().toString(36).slice(2, 8)}`;
  }
  return [input.product.id, input.colorSlug ?? '', input.size ?? ''].join('|');
}

function migrateCart(state: unknown): { lines: CartLine[]; appliedCoupon: string } {
  const lines = (state as { lines?: CartLine[] })?.lines;
  const appliedCoupon = (state as { appliedCoupon?: unknown })?.appliedCoupon;
  if (!Array.isArray(lines)) return { lines: [], appliedCoupon: typeof appliedCoupon === 'string' ? appliedCoupon : '' };

  return {
    appliedCoupon: typeof appliedCoupon === 'string' ? appliedCoupon : '',
    lines: lines.map((line) =>
      line.key.length <= 64
        ? line
        : { ...line, key: `${line.productId}|custom|${Math.random().toString(36).slice(2, 8)}` },
    ),
  };
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      appliedCoupon: '',

      add(input) {
        const key = makeKey(input);
        const quantity = Math.min(Math.max(input.quantity ?? 1, 1), 20);
        const existing = get().lines.find((line) => line.key === key);

        if (existing) {
          set({
            lines: get().lines.map((line) =>
              line.key === key ? { ...line, quantity: Math.min(line.quantity + quantity, 20) } : line,
            ),
          });
        } else {
          const colorName = input.product.colors.find((c) => c.slug === input.colorSlug)?.name;
          const line: CartLine = {
            key,
            productId: input.product.id,
            type: input.product.type,
            quantity,
            colorSlug: input.colorSlug,
            size: input.size ?? null,
            fabricId: input.fabricId ?? null,
            fabricIds: input.fabricIds ?? (input.fabricId ? [input.fabricId] : []),
            laceIds: input.laceIds ?? [],
            laceColors: input.laceColors ?? [],
            latkanIds: input.latkanIds ?? [],
            latkanColors: input.latkanColors ?? [],
            measurement: input.measurement ?? null,
            note: input.note ?? '',
            snapshot: {
              name: input.product.name,
              designId: input.product.designId,
              slug: input.product.slug,
              image: input.product.image,
              ...(colorName ? { colorName } : {}),
              ...(input.fabricName ? { fabricName: input.fabricName } : {}),
              ...(input.laceName ? { laceName: input.laceName } : {}),
              ...(input.latkanName ? { latkanName: input.latkanName } : {}),
            },
          };
          set({ lines: [...get().lines, line] });
        }

        track('CART_ADD', { productId: input.product.id, value: quantity });
        return key;
      },

      remove(key) {
        const line = get().lines.find((l) => l.key === key);
        if (line) track('CART_REMOVE', { productId: line.productId });
        set({ lines: get().lines.filter((l) => l.key !== key) });
      },

      setQuantity(key, quantity) {
        const next = Math.min(Math.max(Math.trunc(quantity) || 1, 1), 20);
        set({ lines: get().lines.map((line) => (line.key === key ? { ...line, quantity: next } : line)) });
      },

      setMeasurement(key, measurement) {
        set({ lines: get().lines.map((line) => (line.key === key ? { ...line, measurement } : line)) });
        track('MEASUREMENT_COMPLETE');
      },

      setNote(key, note) {
        set({ lines: get().lines.map((line) => (line.key === key ? { ...line, note: note.slice(0, 300) } : line)) });
      },

      setAppliedCoupon(coupon) {
        set({ appliedCoupon: coupon.trim().toUpperCase().slice(0, 24) });
      },

      clear() {
        set({ lines: [], appliedCoupon: '' });
      },

      count() {
        return get().lines.reduce((sum, line) => sum + line.quantity, 0);
      },

      find(key) {
        return get().lines.find((line) => line.key === key);
      },
    }),
    {
      name: 'gs_cart_v1',
      version: 3,
      migrate: (state) => migrateCart(state),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ lines: state.lines, appliedCoupon: state.appliedCoupon }),
    },
  ),
);

/** Strips display-only fields before sending a cart to the API. */
export function toApiLines(lines: CartLine[]) {
  return lines.map((line) => ({
    key: line.key,
    productId: line.productId,
    quantity: line.quantity,
    ...(line.colorSlug ? { colorSlug: line.colorSlug } : {}),
    ...(line.size !== null && line.size !== undefined ? { size: line.size } : {}),
    ...(line.fabricId ? { fabricId: line.fabricId } : {}),
    ...(line.fabricIds?.length ? { fabricIds: line.fabricIds } : {}),
    ...(line.laceIds?.length ? { laceIds: line.laceIds } : {}),
    ...(line.laceColors?.length
      ? { laceColors: line.laceColors.map((c) => ({ laceId: c.id, colorName: c.colorName, ...(c.colorHex ? { colorHex: c.colorHex } : {}) })) }
      : {}),
    ...(line.latkanIds?.length ? { latkanIds: line.latkanIds } : {}),
    ...(line.latkanColors?.length
      ? { latkanColors: line.latkanColors.map((c) => ({ latkanId: c.id, colorName: c.colorName, ...(c.colorHex ? { colorHex: c.colorHex } : {}) })) }
      : {}),
    ...(line.measurement
      ? {
          measurement: {
            unit: line.measurement.unit,
            values: line.measurement.values,
            confirmed: line.measurement.confirmed,
          },
        }
      : {}),
    ...(line.note ? { note: line.note } : {}),
  }));
}
