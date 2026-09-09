import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnOutline, Empty, inr } from './shared';
import { AlertTriangle, Users, Package, ClipboardList, TrendingUp, ShoppingCart, Heart, MessageCircle, CreditCard } from 'lucide-react';

interface DashboardData {
  cards: {
    products: number; orders: number; customers: number; events: number;
    revenueMinor: number; revenueOrders: number;
    cartAdds: number; wishlistAdds: number; whatsappEnquiries: number; failedPayments: number;
  };
  statuses: Array<{ _id: string; count: number }>;
  topProducts: Array<{ designId: string; name: string; views: number }>;
  lowStockProducts: Array<{ designId: string; name: string; totalStock: number }>;
}

function rangeQuery(range: string) {
  const to = new Date();
  const from = new Date(to);
  if (range === 'today') from.setHours(0, 0, 0, 0);
  else if (range === 'yesterday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); from.setHours(0, 0, 0, 0); to.setHours(23, 59, 59, 999); }
  else if (range === '7d') from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  else if (range === 'month') from.setDate(1);
  else if (range === 'lastmonth') { from.setDate(1); from.setMonth(from.getMonth() - 1); to.setDate(0); to.setHours(23, 59, 59, 999); }
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export function OverviewModule() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [range, setRange] = useState('30d');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (r: string) => {
    setBusy(true);
    setError('');
    try {
      const dash = await api<DashboardData>(`/admin/dashboard?${rangeQuery(r)}`);
      setData(dash);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Dashboard load nahi hua.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(range); }, [range]);

  const cards = data?.cards;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-muted">Business snapshot</p>
          <p className="hint mt-1">Orders, revenue aur storefront activity — ek nazar mein.</p>
        </div>
        <div className="flex gap-2">
          <select className="field min-h-10 w-auto py-2" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="today">Today</option><option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
            <option value="month">This month</option><option value="lastmonth">Last month</option>
          </select>
          <BtnOutline onClick={() => void load(range)} disabled={busy}>Refresh</BtnOutline>
        </div>
      </div>
      {error ? <div className="mb-5 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      {!cards ? <Empty message="Dashboard data aa raha hai..." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<TrendingUp size={20} />} label="Revenue" value={inr(cards.revenueMinor)} sub={`${cards.revenueOrders} paid orders`} />
            <Kpi icon={<ClipboardList size={20} />} label="Orders" value={cards.orders} sub="Total orders" />
            <Kpi icon={<Users size={20} />} label="Customers" value={cards.customers} sub="Registered users" />
            <Kpi icon={<Package size={20} />} label="Products" value={cards.products} sub="Live products" />
            <Kpi icon={<ShoppingCart size={20} />} label="Cart adds" value={cards.cartAdds} sub="In selected range" />
            <Kpi icon={<Heart size={20} />} label="Wishlist adds" value={cards.wishlistAdds} sub="In selected range" />
            <Kpi icon={<MessageCircle size={20} />} label="WhatsApp enquiries" value={cards.whatsappEnquiries} sub="All time" />
            <Kpi icon={<CreditCard size={20} />} label="Failed payments" value={cards.failedPayments} sub="All time" />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <section className="card p-5">
              <h3 className="section-title">Order pipeline</h3>
              <div className="mt-5 space-y-3">
                {data?.statuses.map((item) => (
                  <div className="flex items-center gap-3 text-sm" key={item._id}>
                    <span className="w-32 text-ink-muted">{item._id.replace(/_/g, ' ')}</span>
                    <div className="h-2 flex-1 rounded-full bg-maroon-50">
                      <div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, item.count * 8)}%` }} />
                    </div>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="card p-5">
              <h3 className="section-title">Top viewed designs</h3>
              <div className="mt-5 divide-y divide-maroon-100">
                {(data?.topProducts ?? []).length === 0 ? <Empty message="Is range mein koi views nahi." /> :
                  data?.topProducts.map((item) => (
                    <div className="flex items-center justify-between gap-3 py-3 text-sm" key={item.designId}>
                      <span className="truncate"><strong>{item.designId}</strong> {item.name}</span>
                      <span className="font-semibold text-maroon-700">{item.views} views</span>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          <section className="card mt-5 p-5">
            <h3 className="section-title flex items-center gap-2"><AlertTriangle size={18} className="text-alert" /> Low stock alerts</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(data?.lowStockProducts ?? []).length === 0 ? <p className="text-sm text-ink-muted">Sab products ka stock theek hai.</p> :
                data?.lowStockProducts.map((item) => (
                  <article className="rounded-xl border border-alert/30 bg-alert/5 p-4" key={item.designId}>
                    <p className="text-xs font-bold tracking-wider text-alert">{item.designId}</p>
                    <p className="mt-1 text-sm font-semibold">{item.name}</p>
                    <p className="mt-2 text-xs text-ink-muted">Stock: <strong className="text-alert">{item.totalStock}</strong></p>
                  </article>
                ))}
            </div>
          </section>

          <div className="mt-5 flex items-center gap-2">
            {data?.statuses.map((s) => <Badge key={s._id} label={s._id} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-maroon-600">{icon}<p className="text-sm text-ink-muted">{label}</p></div>
      <p className="mt-2 text-2xl font-bold text-maroon-700">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{sub}</p>
    </div>
  );
}