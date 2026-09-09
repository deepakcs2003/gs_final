import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, Empty, Toolbar, inr } from './shared';
import { AlertTriangle, Search, Globe2, MonitorSmartphone } from 'lucide-react';

interface CountRow { _id: string; count: number }
interface ProductPerf {
  _id: string; designId: string; name: string; type: string; mrpInr: number; sellingPriceInr: number;
  events?: Record<string, number>;
}
interface Overview {
  eventBreakdown: CountRow[]; topPages: CountRow[]; topSearches: CountRow[]; sourceBreakdown: CountRow[];
  deviceBreakdown: CountRow[]; uniqueSessions: number;
}

function rangeQuery(range: string): string {
  const to = new Date();
  const from = new Date(to);
  if (range === '7d') from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  else if (range === 'month') from.setDate(1);
  else if (range === 'lastmonth') { from.setMonth(from.getMonth() - 1, 1); }
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

const RANGES = [
  { id: '7d', label: 'Last 7 days' }, { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' }, { id: 'lastmonth', label: 'Last month' },
];

export function AnalyticsModule() {
  const [range, setRange] = useState('30d');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [products, setProducts] = useState<ProductPerf[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    void Promise.all([
      api<Overview>(`/admin/analytics/overview?${rangeQuery(range)}`),
      api<{ items: ProductPerf[] }>(`/admin/analytics/products?${rangeQuery(range)}`),
    ])
      .then(([ov, prod]) => { setOverview(ov); setProducts(prod.items); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Analytics load nahi hua.'));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const totalEvents = (overview?.eventBreakdown ?? []).reduce((sum, row) => sum + row.count, 0);
  const pageViews = (overview?.eventBreakdown ?? []).find((row) => row._id === 'PAGE_VIEW')?.count ?? 0;
  const searches = (overview?.topSearches ?? []).reduce((sum, row) => sum + row.count, 0);
  const sourceTotal = (overview?.sourceBreakdown ?? []).reduce((sum, row) => sum + row.count, 0) || 1;

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <Toolbar title="Analytics" count={totalEvents} />
        <div className="flex gap-2 px-5 py-3">
          {RANGES.map((r) => <button key={r.id} onClick={() => setRange(r.id)} className={`chip ${range === r.id ? 'chip-active' : ''}`}>{r.label}</button>)}
        </div>
        {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
        {overview ? (
          <>
            <div className="grid gap-3 px-4 pb-1 sm:grid-cols-2 xl:grid-cols-4">
              <div className="card p-5"><p className="text-sm text-ink-muted">Unique sessions</p><p className="mt-2 text-2xl font-bold text-maroon-700">{overview.uniqueSessions}</p></div>
              <div className="card p-5"><p className="text-sm text-ink-muted">Events</p><p className="mt-2 text-2xl font-bold text-maroon-700">{totalEvents}</p></div>
              <div className="card p-5"><p className="text-sm text-ink-muted">Page views</p><p className="mt-2 text-2xl font-bold text-maroon-700">{pageViews}</p></div>
              <div className="card p-5"><p className="text-sm text-ink-muted">Searches</p><p className="mt-2 text-2xl font-bold text-maroon-700">{searches}</p></div>
            </div>

            <div className="grid gap-5 p-4 lg:grid-cols-2">
              <section className="card p-5">
                <h3 className="section-title">Event breakdown</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.eventBreakdown.map((row) => (
                    <div className="flex items-center gap-3 text-sm" key={row._id}>
                      <span className="w-44 truncate text-ink-muted">{row._id.replace(/_/g, ' ')}</span>
                      <div className="h-2 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, (row.count / (totalEvents || 1)) * 100)}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <div className="space-y-5">
                <section className="card p-5">
                  <h3 className="section-title">Top pages</h3>
                  <div className="mt-3 space-y-2">
                    {overview.topPages.length === 0 ? <p className="text-sm text-ink-muted">Koi page view nahi.</p> :
                      overview.topPages.map((row) => (
                        <div className="flex items-center justify-between gap-2 text-sm" key={row._id}><span className="truncate font-mono text-xs">{row._id || '(home)'}</span><strong>{row.count}</strong></div>
                      ))}
                  </div>
                </section>
                <section className="card p-5">
                  <h3 className="section-title"><Search size={15} className="inline text-maroon-600" /> Top searches</h3>
                  <div className="mt-3 space-y-2">
                    {overview.topSearches.length === 0 ? <p className="text-sm text-ink-muted">Koi search nahi.</p> :
                      overview.topSearches.map((row) => (
                        <div className="flex items-center justify-between gap-2 text-sm" key={row._id}><span className="truncate">{row._id}</span><strong>{row.count}</strong></div>
                      ))}
                  </div>
                </section>
              </div>

              <section className="card p-5">
                <h3 className="section-title"><Globe2 size={15} className="inline text-maroon-600" /> Sources</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.sourceBreakdown.map((row) => (
                    <div className="flex items-center gap-3 text-sm" key={row._id}>
                      <span className="w-28 text-ink-muted">{row._id}</span>
                      <div className="h-2 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-marigold-500" style={{ width: `${Math.min(100, (row.count / sourceTotal) * 100)}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card p-5">
                <h3 className="section-title"><MonitorSmartphone size={15} className="inline text-maroon-600" /> Devices</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.deviceBreakdown.map((row) => (
                    <div className="flex items-center justify-between gap-3 text-sm" key={row._id}>
                      <span className="text-ink-muted">{row._id || 'unknown'}</span>
                      <div className="h-2 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, (row.count / (totalEvents || 1)) * 100)}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </section>

      <section className="card overflow-hidden">
        <Toolbar title="Product performance" count={products.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-maroon-50 text-ink-muted"><tr>
              <th className="p-4">Design</th><th className="p-4">Name</th><th className="p-4">Price</th>
              <th className="p-4">Views</th><th className="p-4">Carts</th><th className="p-4">Wishlist</th><th className="p-4">Buy now</th><th className="p-4">WhatsApp</th><th className="p-4">Shares</th>
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr className="border-t border-maroon-100" key={p._id}>
                  <td className="p-4 font-mono font-semibold text-maroon-700">{p.designId}</td>
                  <td className="p-4">{p.name} <Badge label={p.type} /></td>
                  <td className="p-4">{inr(p.sellingPriceInr * 100)}</td>
                  <td className="p-4 font-bold">{p.events?.PRODUCT_VIEW ?? 0}</td>
                  <td className="p-4">{p.events?.CART_ADD ?? 0}</td>
                  <td className="p-4">{p.events?.WISHLIST_ADD ?? 0}</td>
                  <td className="p-4">{p.events?.BUY_NOW ?? 0}</td>
                  <td className="p-4">{p.events?.WHATSAPP_CLICK ?? 0}</td>
                  <td className="p-4">{p.events?.SHARE ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {products.length === 0 ? <Empty message="Is period mein koi product event nahi." /> : null}
        </div>
        {products.some((p) => (p.events?.PRODUCT_VIEW ?? 0) > 0 && (p.events?.CART_ADD ?? 0) === 0) ? (
          <div className="m-4 flex items-center gap-2 rounded-xl border border-marigold-500/40 bg-marigold-100/40 p-3 text-sm">
            <AlertTriangle size={16} className="text-marigold-600" /><span className="font-semibold text-ink">High views / zero cart products hain — price ya page flow par ek nazar daalein.</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}