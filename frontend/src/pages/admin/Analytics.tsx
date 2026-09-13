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
                    <div className="flex items-center gap-2 text-sm sm:gap-3" key={row._id}>
                      <span className="w-24 shrink-0 truncate text-ink-muted sm:w-44">{row._id.replace(/_/g, ' ')}</span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, (row.count / (totalEvents || 1)) * 100)}%` }} /></div>
                      <strong className="shrink-0">{row.count}</strong>
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
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.length === 0 ? <div className="col-span-full"><Empty message="Is period mein koi product event nahi." /></div> :
            products.map((p) => (
              <article key={p._id} className="rounded-xl border border-maroon-100 bg-white p-4 shadow-card transition hover:border-maroon-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-maroon-700">{p.designId}</p>
                    <p className="truncate font-semibold text-ink">{p.name}</p>
                  </div>
                  <span className="shrink-0 text-lg font-bold text-ink">{inr(p.sellingPriceInr * 100)}</span>
                </div>
                <div className="mt-2">
                  <Badge label={p.type} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([['Views', p.events?.PRODUCT_VIEW ?? 0], ['Carts', p.events?.CART_ADD ?? 0], ['Wishlist', p.events?.WISHLIST_ADD ?? 0], ['Buy now', p.events?.BUY_NOW ?? 0], ['WhatsApp', p.events?.WHATSAPP_CLICK ?? 0], ['Shares', p.events?.SHARE ?? 0]] as const).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-maroon-50/60 px-2 py-1.5 text-center">
                      <p className="text-sm font-bold text-ink">{value}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
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