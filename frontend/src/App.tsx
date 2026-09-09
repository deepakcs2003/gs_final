import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/layout/Header';
import { BottomNav } from './components/layout/BottomNav';
import { Footer } from './components/layout/Footer';
import { FloatingActions } from './components/layout/FloatingActions';
import { OfferPopupHost } from './components/OfferPopup';
import { SearchOverlay } from './components/SearchOverlay';
import { LoginSheet } from './components/LoginSheet';
import { Toaster } from './components/ui';
import { track } from './lib/analytics';

import { HomePage } from './pages/Home';
import { ListingPage } from './pages/Listing';
import { ProductDetailPage } from './pages/ProductDetail';
import { CartPage } from './pages/Cart';
import { MeasurementPage } from './pages/Measurement';
import { CheckoutPage } from './pages/Checkout';
import { OrderSuccessPage } from './pages/OrderSuccess';
import { WishlistPage } from './pages/Wishlist';
import { OrdersPage } from './pages/Orders';
import { AboutPage, ContactPage, FaqPage, PolicyPage, NotFoundPage, ManagedPageView } from './pages/Static';
import { AdminPage } from './pages/Admin';

/** Scrolls to the top on navigation and records the page view. */
function RouteEffects() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    track('PAGE_VIEW');
  }, [location.pathname]);

  return null;
}

export function App() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (isAdmin) {
    return <Routes><Route path="/admin" element={<AdminPage />} /><Route path="*" element={<AdminPage />} /></Routes>;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <RouteEffects />
      <Header />

      <main className="flex-1 pb-nav lg:pb-0">
        <Routes>
          <Route path="/" element={<HomePage />} />

          {/* One listing component, three sections — the type is the only
              difference, which keeps README §83's separation honest. */}
          <Route path="/ready-to-buy" element={<ListingPage type="READY_MADE" />} />
          <Route path="/ready-to-buy/:category" element={<ListingPage type="READY_MADE" />} />
          <Route path="/customize" element={<ListingPage type="CUSTOMIZE" />} />
          <Route path="/customize/:category" element={<ListingPage type="CUSTOMIZE" />} />
          <Route path="/showcase" element={<ListingPage type="SHOWCASE" />} />
          <Route path="/showcase/:category" element={<ListingPage type="SHOWCASE" />} />

          <Route path="/blouse/:slug" element={<ProductDetailPage />} />

          <Route path="/cart" element={<CartPage />} />
          <Route path="/measurement/:cartKey" element={<MeasurementPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:orderNumber" element={<OrderSuccessPage />} />

          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/orders" element={<OrdersPage />} />

          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/policy/:slug" element={<PolicyPage />} />

          {/* Admin-managed content pages (README §85.12) */}
          <Route path="/page/:slug" element={<ManagedPageView />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <Footer />
      <BottomNav />
      <FloatingActions />
      <SearchOverlay />
      <LoginSheet />
      <OfferPopupHost />
      <Toaster />
    </div>
  );
}
