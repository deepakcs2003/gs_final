import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, Search } from 'lucide-react';
import { SmartImage } from '../components/SmartImage';
import { EmptyState } from '../components/ui';
import { useCurrentUser, useMyOrders } from '../hooks/queries';
import { useUi } from '../store/ui';
import { formatDate, formatMoney } from '../lib/format';

/**
 * My Orders (README §35).
 *
 * Signed-in customers see their list. Guests get a lookup form instead —
 * order number plus the mobile number used at checkout — so ordering without
 * an account still leaves a way to track the parcel.
 */
export function OrdersPage() {
  const navigate = useNavigate();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: orders, isLoading } = useMyOrders(Boolean(user));
  const openLogin = useUi((state) => state.openLogin);

  const [lookupNumber, setLookupNumber] = useState('');
  const [lookupMobile, setLookupMobile] = useState('');

  const trackGuestOrder = () => {
    const orderNumber = lookupNumber.trim().toUpperCase();
    if (!orderNumber || lookupMobile.length !== 10) return;
    navigate(`/order/${orderNumber}?mobile=${lookupMobile}`);
  };

  return (
    <div className="mx-auto max-w-3xl px-3 pt-4 sm:px-5">
      <h1 className="section-title mb-4">My Orders</h1>

      {/* Guest tracking */}
      {!user && !userLoading ? (
        <section className="card mb-5 p-4">
          <h2 className="mb-1 font-display text-base font-bold">Order track karein</h2>
          <p className="hint mb-3">Order ID aur mobile number daalein</p>

          <div className="space-y-3">
            <input
              value={lookupNumber}
              onChange={(event) => setLookupNumber(event.target.value.toUpperCase().slice(0, 24))}
              placeholder="Order ID (jaise GSABC123)"
              className="field uppercase"
            />
            <div className="flex gap-2">
              <span className="grid h-12 shrink-0 place-items-center rounded-xl border border-ink-light/30 bg-maroon-50 px-3 text-[15px] font-semibold">
                +91
              </span>
              <input
                value={lookupMobile}
                onChange={(event) => setLookupMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="Mobile number"
                className="field"
              />
            </div>
            <button
              type="button"
              onClick={trackGuestOrder}
              disabled={!lookupNumber || lookupMobile.length !== 10}
              className="btn-primary w-full"
            >
              <Search size={17} />
              Order Dhundein
            </button>
          </div>

          <p className="hint mt-3 text-center">
            Ya{' '}
            <button type="button" onClick={() => openLogin('/orders')} className="font-semibold text-maroon-700 underline">
              login karein
            </button>{' '}
            — saare orders ek jagah dikhenge.
          </p>
        </section>
      ) : null}

      {user ? (
        isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton h-28 rounded-xl2" />
            ))}
          </div>
        ) : !orders || orders.length === 0 ? (
          <EmptyState
            icon={<Package size={30} />}
            title="Abhi tak koi order nahi"
            message="Pehla order karein — hum aapke liye achhe se banayenge."
            action={
              <Link to="/ready-to-buy" className="btn-primary">
                Designs dekhein
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.orderNumber}>
                <Link to={`/order/${order.orderNumber}`} className="card block p-4 transition hover:shadow-lift">
                  <div className="mb-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-ink">{order.orderNumber}</p>
                      <p className="hint">{formatDate(order.placedAt)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-maroon-50 px-2.5 py-1 text-[12px] font-bold text-maroon-700">
                      {order.statusLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {order.items.slice(0, 3).map((item, index) => (
                        <span
                          key={`${item.designId}-${index}`}
                          className="h-14 w-11 overflow-hidden rounded-lg border-2 border-white bg-maroon-50"
                        >
                          <SmartImage src={item.image} alt={item.name} className="object-contain" sizes="44px" />
                        </span>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">
                        {order.items[0]?.name}
                        {order.itemCount > 1 ? ` + ${order.itemCount - 1} aur` : ''}
                      </p>
                      <p className="text-[13px] font-bold text-ink">
                        {formatMoney(order.totalMinor, order.currency)}
                        <span className="ml-1.5 font-normal text-ink-muted">
                          {order.paymentMethod === 'COD' ? 'COD' : 'Paid online'}
                        </span>
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
