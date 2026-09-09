import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { track } from '../lib/analytics';

/* -------------------------------------------------------------------------- */
/* Wishlist (README §26)                                                       */
/* -------------------------------------------------------------------------- */

interface WishlistState {
  ids: string[];
  toggle: (productId: string) => boolean;
  has: (productId: string) => boolean;
  remove: (productId: string) => void;
  clear: () => void;
}

/**
 * Guests keep a wishlist in the browser; on login it is merged into the
 * account via POST /api/cart/wishlist/merge, so nothing a customer saved
 * before signing in is lost.
 */
export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle(productId) {
        const has = get().ids.includes(productId);
        if (has) {
          set({ ids: get().ids.filter((id) => id !== productId) });
          track('WISHLIST_REMOVE', { productId });
          return false;
        }
        set({ ids: [productId, ...get().ids].slice(0, 200) });
        track('WISHLIST_ADD', { productId });
        return true;
      },
      has: (productId) => get().ids.includes(productId),
      remove: (productId) => set({ ids: get().ids.filter((id) => id !== productId) }),
      clear: () => set({ ids: [] }),
    }),
    { name: 'gs_wishlist_v1', storage: createJSONStorage(() => localStorage) },
  ),
);

/* -------------------------------------------------------------------------- */
/* Recently viewed (README §65)                                                */
/* -------------------------------------------------------------------------- */

interface RecentState {
  slugs: string[];
  push: (slug: string) => void;
}

export const useRecentlyViewed = create<RecentState>()(
  persist(
    (set, get) => ({
      slugs: [],
      push(slug) {
        set({ slugs: [slug, ...get().slugs.filter((s) => s !== slug)].slice(0, 12) });
      },
    }),
    { name: 'gs_recent_v1', storage: createJSONStorage(() => localStorage) },
  ),
);

/* -------------------------------------------------------------------------- */
/* Transient UI state — sheets, modals, toasts                                 */
/* -------------------------------------------------------------------------- */

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface UiState {
  searchOpen: boolean;
  menuOpen: boolean;
  /** Set when login is triggered mid-flow so we can return here after (§23). */
  loginRedirect: string | null;
  loginOpen: boolean;
  toasts: Toast[];

  openSearch: () => void;
  closeSearch: () => void;
  toggleMenu: (open?: boolean) => void;
  openLogin: (redirect?: string) => void;
  closeLogin: () => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  searchOpen: false,
  menuOpen: false,
  loginRedirect: null,
  loginOpen: false,
  toasts: [],

  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  toggleMenu: (open) => set({ menuOpen: open ?? !get().menuOpen }),

  openLogin: (redirect) => set({ loginOpen: true, loginRedirect: redirect ?? window.location.pathname }),
  closeLogin: () => set({ loginOpen: false }),

  toast(message, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), 3500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
