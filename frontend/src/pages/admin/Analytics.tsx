import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, Empty, Toolbar, inr } from './shared';
import { AlertTriangle, Search, Globe2, MonitorSmartphone, Eye, ShoppingCart, Heart, ShoppingBag, Share2, MessageCircle, TrendingUp, CheckCircle2, XCircle } from 'lucide-react';
import { SmartImage } from '../../components/SmartImage';

interface CountRow { _id: string; count: number }
interface ProductPerf {
  _id: string; designId: string; name: string; type: string; mrpInr: number; sellingPriceInr: number;
  slug?: string; image?: string; imageAlt?: string; images?: Array<{ url: string; alt?: string }>;
  events?: Record<string, number>;
}
interface CheckoutSummary {
  started: number;
  backedOut: number;
  cancelled: number;
  abandoned: number;
  completed: number;
}

interface Overview {
  eventBreakdown: CountRow[]; topPages: CountRow[]; topSearches: CountRow[]; sourceBreakdown: CountRow[];
  deviceBreakdown: CountRow[]; uniqueSessions: number; ourWorkVisits: number; checkoutSummary: CheckoutSummary;
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

const eventLabel: Record<string, string> = {
  PRODUCT_VIEW: 'Product views', CART_ADD: 'Added to cart', WISHLIST_ADD: 'Wishlist adds', BUY_NOW: 'Buy now clicks',
  WHATSAPP_CLICK: 'WhatsApp enquiries', SHARE: 'Product shares', CHECKOUT_START: 'Checkout starts', ORDER_PLACED: 'Orders placed',
};

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
  const checkoutSummary = overview?.checkoutSummary ?? { started: 0, backedOut: 0, cancelled: 0, abandoned: 0, completed: 0 };
  const checkoutRate = checkoutSummary.started ? Math.round((checkoutSummary.completed / checkoutSummary.started) * 100) : 0;
  const checkoutCards = [
    { label: 'Completed orders', value: checkoutSummary.completed, Icon: CheckCircle2, tone: 'text-leaf' },
    { label: 'Abandoned', value: checkoutSummary.abandoned, Icon: AlertTriangle, tone: 'text-alert' },
    { label: 'Cancelled', value: checkoutSummary.cancelled, Icon: XCircle, tone: 'text-marigold-700' },
    { label: 'Backed out', value: checkoutSummary.backedOut, Icon: XCircle, tone: 'text-ink' },
    { label: 'Checkout rate', value: `${checkoutRate}%`, Icon: TrendingUp, tone: 'text-maroon-700' },
  ];

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      <section className="card overflow-hidden">
        <Toolbar title="Analytics" count={totalEvents} />
        <div className="flex gap-2 overflow-x-auto px-4 py-3 sm:px-5">
          {RANGES.map((r) => <button key={r.id} onClick={() => setRange(r.id)} className={`chip shrink-0 ${range === r.id ? 'chip-active' : ''}`}>{r.label}</button>)}
        </div>
        {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
        {overview ? (
          <>
            <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2 sm:px-4 xl:grid-cols-6">
              {[
                ['Unique sessions', overview.uniqueSessions, 'Visitors', 'text-maroon-700'], ['Events', totalEvents, 'All tracked activity', 'text-maroon-700'],
                ['Page views', pageViews, 'Store browsing', 'text-maroon-700'], ['Searches', searches, 'Product discovery', 'text-maroon-700'],
                ['Checkout starts', checkoutSummary.started, 'Intent to buy', 'text-maroon-700'], ['Our Work visits', overview.ourWorkVisits, 'Portfolio interest', 'text-maroon-700'],
              ].map(([label, value, hint, tone]) => (
                <div key={String(label)} className="rounded-2xl border border-maroon-100 bg-white p-4 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p><p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p><p className="mt-1 text-[11px] text-ink-muted">{hint}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 px-3 pb-4 sm:grid-cols-2 sm:px-4 xl:grid-cols-5">
              {checkoutCards.map(({ label, value, Icon, tone }) => (
                <div key={label} className="flex items-center gap-3 rounded-2xl border border-ink-light/15 bg-ink-light/5 p-4"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white ${tone}`}><Icon size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p><p className={`mt-1 text-xl font-bold ${tone}`}>{value}</p></div></div>
              ))}
            </div>

            <div className="grid min-w-0 gap-5 p-3 sm:p-4 lg:grid-cols-2">
              <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
                <h3 className="section-title">Event breakdown</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.eventBreakdown.map((row) => (
                    <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-3" key={row._id}>
                      <span className="w-24 shrink-0 truncate text-[12px] text-ink-muted sm:w-44 sm:text-sm">{eventLabel[row._id] ?? row._id.replace(/_/g, ' ')}</span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, (row.count / (totalEvents || 1)) * 100)}%` }} /></div>
                      <strong className="shrink-0">{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <div className="space-y-5">
                <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
                  <h3 className="section-title">Top pages</h3>
                  <div className="mt-3 space-y-2">
                    {overview.topPages.length === 0 ? <p className="text-sm text-ink-muted">Koi page view nahi.</p> :
                      overview.topPages.map((row) => (
                        <div className="flex min-w-0 items-center justify-between gap-2 text-sm" key={row._id}><span className="min-w-0 truncate font-mono text-xs">{row._id || '(home)'}</span><strong className="shrink-0">{row.count}</strong></div>
                      ))}
                  </div>
                </section>
                <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
                  <h3 className="section-title"><Search size={15} className="inline text-maroon-600" /> Top searches</h3>
                  <div className="mt-3 space-y-2">
                    {overview.topSearches.length === 0 ? <p className="text-sm text-ink-muted">Koi search nahi.</p> :
                      overview.topSearches.map((row) => (
                        <div className="flex min-w-0 items-center justify-between gap-2 text-sm" key={row._id}><span className="min-w-0 truncate">{row._id}</span><strong className="shrink-0">{row.count}</strong></div>
                      ))}
                  </div>
                </section>
              </div>

              <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
                <h3 className="section-title"><Globe2 size={15} className="inline text-maroon-600" /> Sources</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.sourceBreakdown.map((row) => (
                    <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-3" key={row._id}>
                      <span className="w-20 shrink-0 truncate text-ink-muted sm:w-28">{row._id}</span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-marigold-500" style={{ width: `${Math.min(100, (row.count / sourceTotal) * 100)}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
                <h3 className="section-title"><MonitorSmartphone size={15} className="inline text-maroon-600" /> Devices</h3>
                <div className="mt-4 space-y-2.5">
                  {overview.deviceBreakdown.map((row) => (
                    <div className="flex min-w-0 items-center justify-between gap-2 text-sm" key={row._id}>
                      <span className="w-20 shrink-0 truncate text-ink-muted sm:w-24">{row._id || 'unknown'}</span>
                      <div className="h-2 min-w-0 flex-1 rounded-full bg-maroon-50"><div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, (row.count / (totalEvents || 1)) * 100)}%` }} /></div>
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
        <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
          {products.length === 0 ? <div className="col-span-full"><Empty message="Is period mein koi product event nahi." /></div> :
            products.map((p) => {
              const views = p.events?.PRODUCT_VIEW ?? 0;
              const carts = p.events?.CART_ADD ?? 0;
              const cartRate = views ? Math.round((carts / views) * 100) : 0;
              return (
                <article key={p._id} className="min-w-0 overflow-hidden rounded-2xl border border-maroon-100 bg-white shadow-card transition hover:-translate-y-0.5 hover:border-maroon-200">
                  <div className="relative h-40 bg-maroon-50 sm:h-44">
                    <SmartImage src={p.image || p.images?.[0]?.url || `gs-art:0:${encodeURIComponent(p.designId)}:front`} alt={p.imageAlt ?? p.images?.[0]?.alt ?? p.name} sizes="(max-width: 640px) 100vw, 33vw" />
                    <span className="absolute left-3 top-3"><Badge label={p.type} /></span>
                    <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-maroon-700 shadow-card">{cartRate}% view → cart</span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-mono text-[11px] font-bold text-maroon-700">{p.designId}</p><p className="mt-0.5 line-clamp-2 font-semibold text-ink">{p.name}</p></div>
                      <span className="shrink-0 text-sm font-bold text-ink">{inr(p.sellingPriceInr * 100)}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {([[Eye, 'Views', views], [ShoppingCart, 'Cart', carts], [Heart, 'Wish', p.events?.WISHLIST_ADD ?? 0], [ShoppingBag, 'Buy', p.events?.BUY_NOW ?? 0], [MessageCircle, 'WhatsApp', p.events?.WHATSAPP_CLICK ?? 0], [Share2, 'Share', p.events?.SHARE ?? 0]] as const).map(([Icon, label, value]) => (
                        <div key={label} className="rounded-xl bg-maroon-50/60 px-1.5 py-2 text-center"><Icon size={14} className="mx-auto text-maroon-600" /><p className="mt-1 text-sm font-bold text-ink">{value}</p><p className="truncate text-[9px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p></div>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
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