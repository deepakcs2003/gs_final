import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, Empty, Modal, inr } from './shared';
import { AlertTriangle, Users, Package, ClipboardList, TrendingUp, ShoppingCart, Heart, MessageCircle, CreditCard, ExternalLink, Eye } from 'lucide-react';
import { cloudinarySrc } from '../../lib/image';

interface DashboardData {
  cards: {
    products: number; orders: number; customers: number; events: number;
    revenueMinor: number; revenueOrders: number;
    cartAdds: number; wishlistAdds: number; whatsappEnquiries: number; failedPayments: number;
  };
  statuses: Array<{ _id: string; count: number }>;
  topProducts: Array<{ _id: string; designId: string; name: string; views: number }>;
  lowStockProducts: Array<{ _id: string; designId: string; name: string; totalStock: number }>;
  alerts: Array<{ key: string; label: string; count: number; status: string }>;
}

/* -------------------------------------------------------------------------- */
/* Drill-down types                                                            */
/* -------------------------------------------------------------------------- */

type DrillKind = 'revenue' | 'orders' | 'ordersByStatus' | 'customers' | 'products' | 'cart' | 'wishlist' | 'enquiries' | 'failedPayments';

interface DrillState {
  kind: DrillKind;
  title: string;
  subtitle: string;
  status?: string;
  maxWidth?: string;
}

interface DrillOrderRow {
  orderNumber: string; status: string; placedAt: string;
  amounts: { totalMinor: number };
  payment: { status: string; method: string };
  shipping: { status: string };
  items: Array<{ image?: string; name?: string; designId?: string; quantity?: number; sku?: string }>;
  contact: { name: string; mobile: string };
}

interface DrillCustomerItem {
  _id: string; name: string; mobile: string; email: string; avatarUrl: string; isBlocked: boolean;
  createdAt: string; lastLoginAt: string | null;
  orderCount: number; totalSpentMinor: number; lastOrderAt: string | null;
  cartAdds: number; wishlistAdds: number;
}

interface DrillProductItem {
  _id: string; designId: string; name: string; type: string; image: string; sku: string;
  priceMinor: number; mrpMinor: number; stock: number | null; isActive: boolean;
  allTimeOrders: number; views: number; cartAdds: number; wishlistAdds: number; conversionRatePercent: number;
}

interface DrillAttachmentRow {
  _id: string; at: string;
  product: { _id: string; designId: string; name: string; image: string; sku: string; priceMinor: number } | null;
  customer: { _id: string; name: string; mobile: string; email: string } | null;
  quantity: number; cartValueMinor: number; inCart: boolean;
  converted: { orderNumber: string; status: string; totalMinor: number; paymentStatus: string; placedAt: string } | null;
  currentStock?: number | null;
}

interface DrillRevenue {
  totalMinor: number; paidOrders: number; averageMinor: number;
  pendingMinor: number; pendingOrders: number; refundedMinor: number;
  recent: Array<{ orderNumber: string; placedAt: string; totalMinor: number; paymentStatus: string; customer: string; mobile: string; item: { name: string; designId: string; image: string } | null }>;
}

interface EnquiryRow {
  _id: string; channel: string; message: string; createdAt: string;
  product?: { designId?: string; name?: string } | null;
  user?: { name?: string; mobile?: string; email?: string } | null;
}

interface FailedPaymentRow {
  orderNumber: string; placedAt: string; totalMinor: number;
  paymentId: string; method: string; status: string; failureReason: string;
  customer: string; mobile: string;
}

/* -------------------------------------------------------------------------- */
/* Navigation helpers                                                          */
/* -------------------------------------------------------------------------- */

const alertFilter: Record<string, string> = {
  awaitingReview: 'AWAITING_REVIEW',
  unassigned: 'UNASSIGNED',
  refundFailed: 'REFUND_FAILED',
  highWorkload: 'UNASSIGNED',
};

function goToOrders(filter: string, orderNumber?: string) {
  window.dispatchEvent(new CustomEvent('admin-nav-orders', { detail: { filter, orderNumber } }));
}
function goToProduct(productId: string) {
  window.dispatchEvent(new CustomEvent('admin-nav-products', { detail: { productId } }));
}
function goToCustomer(customerId: string) {
  window.dispatchEvent(new CustomEvent('admin-nav-customers', { detail: { customerId } }));
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

function fmtDT(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

/* -------------------------------------------------------------------------- */
/* Small presentational helpers                                                */
/* -------------------------------------------------------------------------- */

const toneClass: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-alert/15 text-alert',
  neutral: 'bg-maroon-50 text-maroon-700',
};

function Tone({ tone = 'neutral', children }: { tone?: keyof typeof toneClass; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ${toneClass[tone]}`}>{children}</span>;
}

function paymentTone(status: string) {
  if (['PAID', 'COD_PENDING', 'REFUNDED'].includes(status)) return 'ok';
  if (['PENDING', 'COD_ADVANCE_PENDING', 'COD_ADVANCE_PAID', 'REFUND_PENDING'].includes(status)) return 'warn';
  if (['FAILED', 'REFUND_FAILED'].includes(status)) return 'bad';
  return 'neutral';
}

function orderTone(status: string) {
  if (['DELIVERED', 'SHIPPED', 'FULFILLED'].includes(status)) return 'ok';
  if (['AWAITING_REVIEW', 'PRODUCTION', 'CONFIRMED'].includes(status)) return 'warn';
  if (['CANCELLED'].includes(status)) return 'bad';
  return 'neutral';
}

function Thumb({ src, alt }: { src?: string; alt?: string }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-maroon-50 text-maroon-300">
      {src ? <img src={cloudinarySrc(src, 128)} alt={alt ?? ''} className="h-full w-full object-cover" /> : <Package size={18} />}
    </span>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-light/20 text-ink-muted transition hover:border-maroon-300 hover:bg-maroon-50 hover:text-maroon-700">
      {children}
    </button>
  );
}

interface EmptyStateProps { text: string }
function DrawerEmpty({ text }: EmptyStateProps) {
  return <div className="py-6"><Empty message={text} /></div>;
}

/* Column header for every drill table. */
function Cols({ cols, className = 'grid-cols-2' }: { cols: Array<string | ReactNode>; className?: string }) {
  return (
    <div className={`hidden grid ${className} gap-3 rounded-xl bg-maroon-50/70 px-3 py-2 text-[11px] font-bold tracking-wider text-ink-muted sm:grid`}>
      {cols.map((col, i) => <span key={i}>{col}</span>)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drill modal — content varies by kind, motion stays in the shared Modal      */
/* -------------------------------------------------------------------------- */

function drillPath(drill: DrillState, rq: string) {
  switch (drill.kind) {
    case 'revenue': return `/admin/dashboard/revenue?${rq}`;
    case 'orders': return `/admin/orders?${rq}`;
    case 'ordersByStatus': return `/admin/orders?${rq}&status=${encodeURIComponent(drill.status ?? '')}`;
    case 'customers': return `/admin/dashboard/customers?${rq}`;
    case 'products': return `/admin/dashboard/products?${rq}`;
    case 'cart': return `/admin/dashboard/cart-adds?${rq}`;
    case 'wishlist': return `/admin/dashboard/wishlist-adds?${rq}`;
    case 'enquiries': return '/admin/enquiries';
    case 'failedPayments': return `/admin/dashboard/failed-payments?${rq}`;
  }
}

function DrillBody({ drill, data }: { drill: DrillState; data: Record<string, unknown> }) {
  if (drill.kind === 'revenue') return <RevenueDrill data={data} />;
  if (drill.kind === 'orders' || drill.kind === 'ordersByStatus') return <OrdersDrill data={data} />;
  if (drill.kind === 'customers') return <CustomersDrill data={data} />;
  if (drill.kind === 'products') return <ProductsDrill data={data} />;
  if (drill.kind === 'cart' || drill.kind === 'wishlist') return <AttachmentDrill data={data} wishlist={drill.kind === 'wishlist'} />;
  if (drill.kind === 'enquiries') return <EnquiriesDrill data={data} />;
  return <FailedPaymentsDrill data={data} />;
}

function DrillModal({ drill, range, onClose }: {
  drill: DrillState; range: string; onClose: () => void;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const activeCtrl = useRef<AbortController | null>(null);
  /** Stable query string — changes only when the selected range really changes. */
  const rq = useMemo(() => rangeQuery(range), [range]);

  const load = useCallback(async () => {
    activeCtrl.current?.abort();
    const controller = new AbortController();
    activeCtrl.current = controller;
    setBusy(true);
    setError('');
    setData(null);
    try {
      const result = await api<Record<string, unknown>>(drillPath(drill, rq), { quiet: true, signal: controller.signal });
      if (!controller.signal.aborted) setData(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'Data load nahi hua.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [drill, rq]);

  useEffect(() => {
    void load();
    return () => activeCtrl.current?.abort();
  }, [load]);

  return (
    <Modal open onClose={onClose} title={drill.title} subtitle={drill.subtitle} maxWidth={drill.maxWidth ?? 'sm:max-w-3xl'}>
      {busy ? <div className="py-6"><Empty message="Data aa raha hai..." /></div>
        : error ? <div className="flex items-center justify-between gap-3 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">
            <span>{error}</span>
            <BtnGhost onClick={() => void load()}>Dobara try karein</BtnGhost>
          </div>
        : data ? <DrillBody drill={drill} data={data} />
        : null}
    </Modal>
  );
}

/* ------------------------------- Revenue ---------------------------------- */

function RevenueDrill({ data }: { data: Record<string, unknown> }) {
  const rev = data as unknown as DrillRevenue;
  const stat = [
    { label: 'Paid revenue', value: inr(rev.totalMinor), className: 'card p-4' },
    { label: 'Paid orders', value: rev.paidOrders, className: 'card p-4' },
    { label: 'Average order', value: inr(rev.averageMinor), className: 'card p-4' },
    { label: 'Pending (unpaid)', value: `${inr(rev.pendingMinor)} · ${rev.pendingOrders}`, className: 'card p-4' },
    { label: 'Refunded (completed)', value: inr(rev.refundedMinor), className: 'card p-4' },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat.map((s) => (
          <div key={s.label} className={s.className}>
            <p className="text-xs text-ink-muted">{s.label}</p>
            <p className="mt-1 text-sm font-bold text-maroon-700">{s.value}</p>
          </div>
        ))}
      </div>
      <h4 className="mt-5 mb-2 text-sm font-bold text-ink">Recent paid orders</h4>
      {rev.recent.length === 0 ? <DrawerEmpty text="Is range mein koi paid order nahi." /> : (
        <div className="space-y-2">
          {rev.recent.map((o) => (
            <div key={o.orderNumber} className="flex items-center gap-3 rounded-xl border border-ink-light/10 p-3 text-sm">
              <Thumb src={o.item?.image} alt={o.item?.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.item ? `${o.item.designId} · ${o.item.name}` : o.customer}</p>
                <p className="truncate text-xs text-ink-muted">{o.orderNumber} · {o.customer} {o.mobile ? `· ${o.mobile}` : ''} · {fmtDT(o.placedAt)}</p>
              </div>
              <Tone tone={paymentTone(o.paymentStatus)}>{o.paymentStatus}</Tone>
              <strong>{inr(o.totalMinor)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Orders ---------------------------------- */

function OrdersDrill({ data }: { data: Record<string, unknown> }) {
  const rows = (data.items as DrillOrderRow[]) ?? [];
  return (
    <div>
      <p className="hint mb-3">Koi bhi row chhuno — Orders tab mein poora order khulega.</p>
      {rows.length === 0 ? <DrawerEmpty text="Is range mein koi order nahi." /> : (
        <div className="space-y-2">
          {rows.map((order) => {
            const first = order.items?.[0];
            const qty = (order.items ?? []).reduce((sum, it) => sum + (it.quantity ?? 1), 0);
            return (
              <button key={order.orderNumber} type="button"
                onClick={() => goToOrders('ALL', order.orderNumber)}
                className="flex w-full items-center gap-3 rounded-xl border border-ink-light/10 p-3 text-left text-sm transition hover:border-maroon-200 hover:bg-maroon-50/40">
                <Thumb src={first?.image} alt={first?.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{first ? `${first.designId ?? '—'} · ${first.name ?? ''}` : 'Order'}</p>
                  <p className="truncate text-xs text-ink-muted">{order.orderNumber} · {order.contact.name} {order.contact.mobile ? `· ${order.contact.mobile}` : ''} · {fmtDT(order.placedAt)}</p>
                </div>
                <span className="hidden text-xs text-ink-muted sm:block">Qty {qty}</span>
                <Tone tone={orderTone(order.status)}>{order.status.replace(/_/g, ' ')}</Tone>
                <Tone tone={paymentTone(order.payment.status)}>{order.payment.status}</Tone>
                <strong>{inr(order.amounts.totalMinor)}</strong>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Customers ---------------------------------- */

function CustomersDrill({ data }: { data: Record<string, unknown> }) {
  const rows = (data.items as DrillCustomerItem[]) ?? [];
  return (
    <div>
      <p className="hint mb-3">Koi bhi card chhuno — Customers tab mein poora profile khulega.</p>
      {rows.length === 0 ? <DrawerEmpty text="Koi registered customer nahi." /> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((c) => (
            <button key={c._id} type="button"
              onClick={() => goToCustomer(c._id)}
              className="rounded-xl border border-ink-light/10 p-3 text-left transition hover:border-maroon-200 hover:bg-maroon-50/40">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon-100 font-bold text-maroon-700">
                  {c.avatarUrl ? <img src={cloudinarySrc(c.avatarUrl, 96)} alt="" className="h-full w-full rounded-full object-cover" /> : (c.name || 'G').charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.name || 'Guest'}</p>
                  <p className="truncate text-xs text-ink-muted">{c.mobile || c.email || '—'}</p>
                </div>
                <Tone tone={c.isBlocked ? 'bad' : 'ok'}>{c.isBlocked ? 'Blocked' : 'Active'}</Tone>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-maroon-50/70 p-2"><p className="text-xs font-bold text-maroon-700">{c.orderCount}</p><p className="text-[10px] text-ink-muted">Orders</p></div>
                <div className="rounded-lg bg-maroon-50/70 p-2"><p className="text-xs font-bold text-maroon-700">{inr(c.totalSpentMinor)}</p><p className="text-[10px] text-ink-muted">Spent</p></div>
                <div className="rounded-lg bg-maroon-50/70 p-2"><p className="text-xs font-bold text-maroon-700">{c.cartAdds}</p><p className="text-[10px] text-ink-muted">Cart adds</p></div>
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">Registered {fmtDT(c.createdAt)}{c.lastOrderAt ? ` · Last order ${fmtDT(c.lastOrderAt)}` : ''}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Products ---------------------------------- */

function ProductsDrill({ data }: { data: Record<string, unknown> }) {
  const rows = (data.items as DrillProductItem[]) ?? [];
  return (
    <div>
      <p className="hint mb-3">Koi bhi row chhuno — Products tab mein design khulega.</p>
      {rows.length === 0 ? <DrawerEmpty text="Koi product nahi." /> : (
        <div className="space-y-2">
          <Cols cols={['Design', 'Status', 'Stock', 'Price', 'Range', 'Orders']} className="grid-cols-6" />
          {rows.map((p) => (
            <button key={p._id} type="button"
              onClick={() => goToProduct(p._id)}
              className="grid w-full grid-cols-6 items-center gap-3 rounded-xl border border-ink-light/10 p-2.5 text-left text-sm transition hover:border-maroon-200 hover:bg-maroon-50/40">
              <span className="flex min-w-0 items-center gap-2.5">
                <Thumb src={p.image} alt={p.name} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.designId}</span>
                  <span className="block truncate text-xs text-ink-muted">{p.name}</span>
                </span>
              </span>
              <Tone tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Live' : 'Archived'}</Tone>
              <span className="text-xs text-ink-muted sm:hidden">{p.stock === null ? '—' : `${p.stock} stock`}</span>
              <span className="hidden items-center justify-center sm:flex">{p.stock === null ? <span className="text-xs text-ink-muted">Custom</span> : p.stock}</span>
              <span className="hidden text-xs text-ink-muted sm:block">{p.priceMinor ? inr(p.priceMinor) : '—'}</span>
              <span className="hidden text-xs text-ink-muted sm:block">V {p.views} · C {p.cartAdds} · W {p.wishlistAdds}</span>
              <span className="hidden text-xs text-ink-muted sm:block">{p.allTimeOrders}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------- Cart / wishlist attachments ----------------------- */

function AttachmentDrill({ data, wishlist }: { data: Record<string, unknown>; wishlist: boolean }) {
  const rows = (data.items as DrillAttachmentRow[]) ?? [];
  return (
    <div>
      <p className="hint mb-3">
        {wishlist
          ? 'Hover karke detail dekho — design ko abhi bhi wishlist mein hai ya order ho gaya.'
          : 'Hover karke detail dekho — item abhi bhi cart mein hai, cart se hata diya gaya, ya order mein badal gaya.'}
      </p>
      {rows.length === 0 ? <DrawerEmpty text={wishlist ? 'Is range mein koi wishlist add nahi.' : 'Is range mein koi cart add nahi.'} /> : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row._id} className="rounded-xl border border-ink-light/10 p-3">
              <div className="flex items-center gap-3 text-sm">
                <Thumb src={row.product?.image} alt={row.product?.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{row.product ? `${row.product.designId} · ${row.product.name}` : 'Unknown design'}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {row.product?.sku ? `SKU ${row.product.sku} · ` : ''}
                    {row.customer ? `${row.customer.name || 'Guest'} · ${row.customer.mobile || row.customer.email || ''}` : 'Guest (login nahi kiya)'}
                    {' · '}{fmtDT(row.at)}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-xs text-ink-muted">Qty {row.quantity}</p>
                  <p className="text-xs font-semibold text-maroon-700">{inr(row.cartValueMinor)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.product ? <IconBtn label="Product kholo" onClick={() => goToProduct(row.product!._id)}><ExternalLink size={14} /></IconBtn> : null}
                  {row.customer ? <IconBtn label="Customer kholo" onClick={() => goToCustomer(row.customer!._id)}><Users size={14} /></IconBtn> : null}
                  {row.converted ? <IconBtn label="Order kholo" onClick={() => goToOrders('ALL', row.converted!.orderNumber)}><ClipboardList size={14} /></IconBtn> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {row.converted
                  ? <>
                      <Tone tone="ok">Converted → {row.converted.orderNumber}</Tone>
                      <Tone tone={orderTone(row.converted.status)}>{row.converted.status.replace(/_/g, ' ')}</Tone>
                      <Tone tone={paymentTone(row.converted.paymentStatus)}>{row.converted.paymentStatus}</Tone>
                      <span className="text-[11px] text-ink-muted">{inr(row.converted.totalMinor)} · {fmtDT(row.converted.placedAt)}</span>
                    </>
                  : wishlist
                    ? (row.inCart ? <Tone tone="warn">Still in wishlist</Tone> : <Tone tone="neutral">Wishlist se hata diya</Tone>)
                    : row.inCart ? <Tone tone="warn">Still in cart · {inr(row.cartValueMinor)}</Tone> : <Tone tone="neutral">Cart se hata diya</Tone>}
                {wishlist && row.currentStock !== undefined && row.currentStock !== null
                  ? <span className="text-[11px] text-ink-muted">Current stock {row.currentStock}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Enquiries --------------------------------- */

function EnquiriesDrill({ data }: { data: Record<string, unknown> }) {
  const rows = (data.items as EnquiryRow[]) ?? [];
  const channelLabel: Record<string, string> = { WHATSAPP: 'WhatsApp', CALL: 'Call', FORM: 'Form' };
  return (
    <div>
      <p className="hint mb-3">WhatsApp / call / form enquiries — model mein name–phone nahi, isliye customer profile link nahi dikhata. Ledger mein response status track nahi hota.</p>
      {rows.length === 0 ? <DrawerEmpty text="Abhi tak koi enquiry nahi aayi." /> : (
        <div className="space-y-2">
          {rows.map((q) => (
            <div key={q._id} className="flex items-start gap-3 rounded-xl border border-ink-light/10 p-3 text-sm">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon-100 text-maroon-700"><MessageCircle size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{q.user?.name || 'Guest'} {q.user?.mobile ? `· ${q.user.mobile}` : ''}{q.user?.email ? ` · ${q.user.email}` : ''}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{channelLabel[q.channel] ?? q.channel} · {fmtDT(q.createdAt)}</p>
                <p className="mt-1 text-sm text-ink">{q.message || '—'}</p>
                {q.product?.designId ? <p className="mt-1 text-xs text-ink-muted">Design: {q.product.designId}{q.product.name ? ` · ${q.product.name}` : ''}</p> : null}
              </div>
              <Tone tone="neutral">{channelLabel[q.channel] ?? q.channel}</Tone>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Failed payments ----------------------------- */

function FailedPaymentsDrill({ data }: { data: Record<string, unknown> }) {
  const rows = (data.items as FailedPaymentRow[]) ?? [];
  return (
    <div>
      <p className="hint mb-3">Payment FAILED orders — retry abhi nahi hua, isliye customer ko follow-up karo.</p>
      {rows.length === 0 ? <DrawerEmpty text="Koi failed payment nahi — sab theek hai." /> : (
        <div className="space-y-2">
          <Cols cols={['Order / Payment', 'Customer', 'Amount', 'Reason', 'When', 'Retry']} className="grid-cols-6" />
          {rows.map((row) => (
            <button key={row.orderNumber} type="button"
              onClick={() => goToOrders('ALL', row.orderNumber)}
              className="grid w-full grid-cols-6 items-center gap-3 rounded-xl border border-alert/20 p-2.5 text-left text-sm transition hover:border-alert/40 hover:bg-alert/5">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{row.orderNumber}</span>
                <span className="block truncate text-xs text-ink-muted">{row.paymentId ? `Payment ${row.paymentId}` : 'Payment ID nahi mila'}</span>
              </span>
              <span className="hidden truncate text-xs text-ink-muted sm:block">{row.customer} {row.mobile ? `· ${row.mobile}` : ''}</span>
              <strong>{inr(row.totalMinor)}</strong>
              <span className="hidden truncate text-xs sm:block">{row.failureReason || '—'}</span>
              <span className="hidden text-xs text-ink-muted sm:block">{fmtDT(row.placedAt)}</span>
              <Tone tone="bad">Retry pending</Tone>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

export function OverviewModule() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [range, setRange] = useState('30d');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drill, setDrill] = useState<DrillState | null>(null);

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

  const open = (kind: DrillKind, opts: { status?: string; title: string; subtitle: string; maxWidth?: string }) =>
    setDrill({ kind, ...opts });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-muted">Business snapshot</p>
          <p className="hint mt-1">Orders, revenue aur storefront activity — ek nazar mein. Har card click karke andar dekho.</p>
        </div>
        <div className="flex gap-2">
          <select className="field min-h-10 w-auto py-2" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="today">Today</option><option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
            <option value="month">This month</option><option value="lastmonth">Last month</option>
          </select>
          <BtnGhost onClick={() => void load(range)} disabled={busy}>Refresh</BtnGhost>
        </div>
      </div>
      {error ? <div className="mb-5 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      {!cards ? <Empty message="Dashboard data aa raha hai..." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<TrendingUp size={20} />} label="Revenue" value={inr(cards.revenueMinor)} sub={`${cards.revenueOrders} paid orders`}
              onClick={() => open('revenue', { title: 'Revenue', subtitle: `Paid + pending + refunded — selected range` })} />
            <Kpi icon={<ClipboardList size={20} />} label="Orders" value={cards.orders} sub="Total orders"
              onClick={() => open('orders', { title: 'Orders', subtitle: 'Selected range ke saare orders' })} />
            <Kpi icon={<Users size={20} />} label="Customers" value={cards.customers} sub="Registered users"
              onClick={() => open('customers', { title: 'Customers', subtitle: 'Registered users + order & add-to-cart stats' })} />
            <Kpi icon={<Package size={20} />} label="Products" value={cards.products} sub="Live products"
              onClick={() => open('products', { title: 'Products', subtitle: 'Designs + views/cart/wishlist stats', maxWidth: 'sm:max-w-4xl' })} />
            <Kpi icon={<ShoppingCart size={20} />} label="Cart adds" value={cards.cartAdds} sub="In selected range"
              onClick={() => open('cart', { title: 'Cart adds', subtitle: 'Is range mein kaun kya cart mein daala' })} />
            <Kpi icon={<Heart size={20} />} label="Wishlist adds" value={cards.wishlistAdds} sub="In selected range"
              onClick={() => open('wishlist', { title: 'Wishlist adds', subtitle: 'Is range mein kaun kya wishlist mein rakh raha hai' })} />
            <Kpi icon={<MessageCircle size={20} />} label="WhatsApp enquiries" value={cards.whatsappEnquiries} sub="All time"
              onClick={() => open('enquiries', { title: 'WhatsApp enquiries', subtitle: 'Storefront se bheji gayi enquiries' })} />
            <Kpi icon={<CreditCard size={20} />} label="Failed payments" value={cards.failedPayments} sub="All time"
              onClick={() => open('failedPayments', { title: 'Failed payments', subtitle: 'Payment FAILED orders — follow-up required' })} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <section className="card p-5">
              <h3 className="section-title">Order pipeline</h3>
              <div className="mt-5 space-y-2">
                {data?.statuses.map((item) => (
                  <button key={item._id} type="button"
                    onClick={() => open('ordersByStatus', { status: item._id, title: `Orders — ${item._id.replace(/_/g, ' ')}`, subtitle: 'Selected range ke orders' })}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-sm transition hover:bg-maroon-50/60">
                    <span className="w-32 text-left text-ink-muted">{item._id.replace(/_/g, ' ')}</span>
                    <div className="h-2 flex-1 rounded-full bg-maroon-50">
                      <div className="h-2 rounded-full bg-maroon-500" style={{ width: `${Math.min(100, item.count * 8)}%` }} />
                    </div>
                    <strong className="w-8 text-right">{item.count}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="card p-5">
              <h3 className="section-title">Top viewed designs</h3>
              <div className="mt-5 divide-y divide-maroon-100">
                {(data?.topProducts ?? []).length === 0 ? <Empty message="Is range mein koi views nahi." /> :
                  data?.topProducts.map((item) => (
                    <button key={item.designId} type="button"
                      onClick={() => goToProduct(item._id)}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm transition hover:bg-maroon-50/40">
                      <span className="truncate"><strong>{item.designId}</strong> {item.name}</span>
                      <span className="flex shrink-0 items-center gap-2 font-semibold text-maroon-700"><Eye size={14} />{item.views} views</span>
                    </button>
                  ))}
              </div>
            </section>
          </div>

          <section className="card mt-5 p-5">
            <h3 className="section-title flex items-center gap-2"><AlertTriangle size={18} className="text-alert" />Order workflow — inaam action ke liye</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {(data?.alerts ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">Abhi koi urgent action nahi.</p>
              ) : data?.alerts.map((alert) => (
                <button key={alert.key} type="button"
                  onClick={() => goToOrders(alertFilter[alert.key] ?? 'AWAITING_REVIEW')}
                  className="rounded-xl border border-alert/30 bg-alert/5 px-4 py-3 text-left text-sm transition hover:bg-alert/10">
                  <span className="font-bold text-alert">{alert.count}</span>
                  <span className="ml-2 font-semibold">{alert.label}</span>
                  <span className="ml-2 text-xs text-ink-muted">→ Orders</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card mt-5 p-5">
            <h3 className="section-title flex items-center gap-2"><AlertTriangle size={18} className="text-alert" /> Low stock alerts</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(data?.lowStockProducts ?? []).length === 0 ? <p className="text-sm text-ink-muted">Sab products ka stock theek hai.</p> :
                data?.lowStockProducts.map((item) => (
                  <button key={item.designId} type="button"
                    onClick={() => goToProduct(item._id)}
                    className="rounded-xl border border-alert/30 bg-alert/5 p-4 text-left transition hover:bg-alert/10">
                    <p className="text-xs font-bold tracking-wider text-alert">{item.designId}</p>
                    <p className="mt-1 text-sm font-semibold">{item.name}</p>
                    <p className="mt-2 text-xs text-ink-muted">Stock: <strong className="text-alert">{item.totalStock}</strong></p>
                  </button>
                ))}
            </div>
          </section>

          <div className="mt-5 flex items-center gap-2">
            {data?.statuses.map((s) => <Badge key={s._id} label={s._id} />)}
          </div>
        </>
      )}

      {drill ? (
        <DrillModal
          drill={drill}
          range={range}
          onClose={() => setDrill(null)}
        />
      ) : null}
    </div>
  );
}

function Kpi({ icon, label, value, sub, onClick }: { icon: ReactNode; label: string; value: ReactNode; sub: string; onClick?: () => void }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick}
      className={`card p-5 text-left transition ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-maroon-200' : ''}`}>
      <div className="flex items-center gap-2 text-maroon-600">{icon}<p className="text-sm text-ink-muted">{label}</p></div>
      <p className="mt-2 text-2xl font-bold text-maroon-700">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{sub}</p>
    </button>
  );
}