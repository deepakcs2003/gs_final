import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnOutline, BtnPrimary, Field, ImageLightbox, Modal, TextInput, Toolbar, inr } from './shared';
import { ChevronDown, ChevronRight, Eye, X, Check, Truck, LinkIcon, Image as ImageIcon, Scissors, RefreshCw, SlidersHorizontal, UserRound, Printer, FileImage } from 'lucide-react';
import clsx from 'clsx';
import { cloudinarySrc } from '../../lib/image';

const statuses = ['AWAITING_REVIEW', 'PLACED', 'CONFIRMED', 'PROCESSING', 'STITCHING', 'QUALITY_CHECK', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED'];

interface TailorHistoryEntry { tailorId: string; tailorName: string; at: string; reason: string; }
interface TailorAssignment { tailorId: string; tailorName: string; assignedAt: string | null; status: string; notes: string; history: TailorHistoryEntry[]; }
interface OrderOptionSnapshot { name: string; material?: string; colorName?: string; image: string; }

interface AdminOrder {
  _id: string; orderNumber: string; status: string; isGuest: boolean;
  contact: { name: string; mobile: string; email: string };
  address: { line1: string; line2: string; city: string; state: string; pincode: string; country: string };
  currency: string; amounts: { subtotalMinor: number; discountMinor: number; shippingMinor: number; totalMinor: number; couponCode: string; codAdvanceMinor?: number; codBalanceMinor?: number };
  payment: { method: string; status: string; razorpayOrderId: string; razorpayPaymentId: string; paidAt: string | null; failureReason: string };
  items: Array<{ designId: string; name: string; type: string; quantity: number; colorName: string; size: number | null; sku?: string; fabricName: string; fabricDetails?: OrderOptionSnapshot[]; laceNames: string[]; laceDetails?: OrderOptionSnapshot[]; latkanNames?: string[]; latkanDetails?: OrderOptionSnapshot[]; measurement: { unit: string; values: Record<string, number> } | null; lineTotalMinor: number; image: string; unitBaseMinor?: number; unitFabricMinor?: number; unitLaceMinor?: number; unitLatkanMinor?: number; unitStitchingMinor?: number }>;
  statusHistory: Array<{ status: string; at: string; note: string }>;
  shipping: {
    provider: string; shiprocketOrderId: string; shipmentId: string; awb: string; courier: string; courierId: string;
    trackingUrl: string; estimatedDeliveryAt: string | null;
    status: string; statusText: string; lastSyncedAt: string | null; pickupScheduledAt: string | null; shippedAt: string | null; deliveredAt: string | null;
  };
  customerNote: string; placedAt: string;
  promisedDeliveryAt: string | null;
  review: { status: string; reviewedAt: string | null; reviewNote: string; flags: string[] } | null;
  production: { complexity: string; productionUnits: number; estimatedWorkingDays: number; calculatedAt: string | null } | null;
  deliveryEstimate: { stitchingWorkingDays: number; packingWorkingDays: number; shippingDays: number; bufferDays: number; fromDate: string | null; toDate: string | null; workingDaysUsed: number; calculatedAt: string | null } | null;
  tailor: TailorAssignment | null;
  cancellation: {
    cancelledByLabel: string; cancelledAt: string | null; reason: string; paymentStatusAtCancel: string;
    refund: { status: string; razorpayRefundId: string; amountMinor: number; requestedAt: string | null; completedAt: string | null; failureReason: string; attempts: number };
    notificationStatus: string; notificationMessage: string;
  } | null;
  risk: { flags: string[]; flagLabels: string[]; reviewRecommended: boolean } | null;
  customerStats: { previousOrders: number; previousCancelled: number } | null;
  itemCategories?: string[];
  liveWorkload?: { activeUnits: number; activeOrders: number; dailyCapacity: number };
}

export function OrdersModule({ initialFilter, initialOrderNumber }: { initialFilter?: string; initialOrderNumber?: string } = {}) {
  const [items, setItems] = useState<AdminOrder[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialFilter ?? 'ALL');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const targetRef = useRef(initialOrderNumber ?? null);

  const load = async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter === 'UNASSIGNED') params.set('tailor', 'unassigned');
      else if (statusFilter === 'REFUND_PENDING') params.set('refund', 'pending');
      else if (statusFilter === 'REFUND_FAILED') params.set('refund', 'failed');
      else if (statusFilter === 'REFUNDED') params.set('refund', 'refunded');
      else if (statusFilter === 'PAYMENT_PAID') params.set('payment', 'PAID');
      else if (statusFilter === 'PAYMENT_PENDING') params.set('payment', 'PENDING');
      else if (statusFilter === 'PAYMENT_COD_PENDING') params.set('payment', 'COD_PENDING');
      else if (statusFilter === 'PAYMENT_COD_ADVANCE_PENDING') params.set('payment', 'COD_ADVANCE_PENDING');
      else if (statusFilter === 'PAYMENT_FAILED') params.set('payment', 'FAILED');
      else if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await api<{ items: AdminOrder[] }>(`/admin/orders?${params.toString()}`);
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Orders load nahi hue.'); }
  };
  useEffect(() => { void load(); }, [statusFilter]);

  useEffect(() => {
    if (!initialOrderNumber || !targetRef.current) return;
    targetRef.current = null;
    const cached = items.find((o) => o.orderNumber === initialOrderNumber);
    if (cached) { setSelected(cached); return; }
    api<{ order: AdminOrder }>(`/admin/orders/${initialOrderNumber}`)
      .then((res) => setSelected(res.order))
      .catch(() => setError('Order kholte waqt gadbad.'));
  }, [items, initialOrderNumber]);

  const search = (q: string) => { setQuery(q); };
  useEffect(() => {
    const handle = setTimeout(() => { if (query.trim() && query.trim().length >= 2) void load(); }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  const filtered = useMemo(() => items, [items]);

  const updateStatus = (order: AdminOrder, status: string) => {
    void setBusy(order.orderNumber);
    void api(`/admin/orders/${order.orderNumber}/status`, { method: 'PATCH', body: { status, note: '' } })
      .then(() => {
        setItems((items) => items.map((o) => o.orderNumber === order.orderNumber ? { ...o, status } : o));
        if (selected?.orderNumber === order.orderNumber) setSelected((s) => (s ? { ...s, status } : s));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Status update nahi hua.'))
      .finally(() => setBusy(''));
  };

  const reloadSelected = async () => {
    if (!selected) return;
    const res = await api<{ order: AdminOrder }>(`/admin/orders/${selected.orderNumber}`);
    setSelected(res.order);
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of statuses) map[s] = 0;
    for (const o of items) map[o.status] = (map[o.status] ?? 0) + 1;
    map.AWAITING_REVIEW = items.filter((o) => o.status === 'AWAITING_REVIEW' && ['PAID', 'COD_PENDING'].includes(o.payment?.status ?? '')).length;
    map.UNASSIGNED = items.filter((o) => o.status !== 'CANCELLED' && o.status !== 'RETURNED' && o.tailor?.status !== 'ASSIGNED').length;
    map.REFUND_PENDING = items.filter((o) => o.cancellation?.refund?.status === 'PENDING' || o.cancellation?.refund?.status === 'PROCESSING').length;
    map.REFUND_FAILED = items.filter((o) => o.cancellation?.refund?.status === 'FAILED').length;
    map.REFUNDED = items.filter((o) => o.cancellation?.refund?.status === 'COMPLETED').length;
    map.PAYMENT_PAID = items.filter((o) => o.payment?.status === 'PAID').length;
    map.PAYMENT_PENDING = items.filter((o) => o.payment?.status === 'PENDING').length;
    map.PAYMENT_COD_PENDING = items.filter((o) => o.payment?.status === 'COD_PENDING').length;
    map.PAYMENT_COD_ADVANCE_PENDING = items.filter((o) => o.payment?.status === 'COD_ADVANCE_PENDING').length;
    map.PAYMENT_FAILED = items.filter((o) => o.payment?.status === 'FAILED').length;
    return map;
  }, [items]);

  const specialFilters = ['UNASSIGNED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'];

  const paymentFilters: Array<{ key: string; label: string }> = [
    { key: 'PAYMENT_PAID', label: 'Payment: Paid' },
    { key: 'PAYMENT_PENDING', label: 'Pending (Razorpay)' },
    { key: 'PAYMENT_COD_PENDING', label: 'COD pending' },
    { key: 'PAYMENT_COD_ADVANCE_PENDING', label: 'COD advance pending' },
    { key: 'PAYMENT_FAILED', label: 'Payment failed' },
  ];

  /* Ek hi filter list — desktop chips + mobile Filter ▾ sheet dono yahin se. */
  const filterOptions = useMemo(() => [
    { key: 'ALL', label: `All (${items.length})` },
    { key: 'AWAITING_REVIEW', label: `Awaiting review (${counts.AWAITING_REVIEW ?? 0})` },
    { key: 'UNASSIGNED', label: `No tailor (${counts.UNASSIGNED ?? 0})` },
    ...statuses.filter((s) => s !== 'AWAITING_REVIEW').map((s) => ({ key: s, label: `${s.replace('_', ' ')} (${counts[s] ?? 0})` })),
    ...specialFilters.map((f) => ({ key: f, label: `${f.replace('_', ' ')} (${counts[f] ?? 0})` })),
    ...paymentFilters.map((f) => ({ key: f.key, label: `${f.label} (${counts[f.key] ?? 0})` })),
  ], [items, counts]);

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Order management" count={filtered.length} searchPlaceholder="Order ID, customer, mobile" query={query} onQuery={search} />
      <div className="hidden lg:flex gap-2 overflow-x-auto px-2 py-3">
        <button onClick={() => { setStatusFilter('ALL'); }} className={`chip whitespace-nowrap ${statusFilter === 'ALL' ? 'chip-active' : ''}`}>All ({items.length})</button>
        <button onClick={() => { setStatusFilter('AWAITING_REVIEW'); }} className={`chip whitespace-nowrap ${statusFilter === 'AWAITING_REVIEW' ? 'chip-active' : ''}`}>Awaiting review ({counts.AWAITING_REVIEW ?? 0})</button>
        <button onClick={() => { setStatusFilter('UNASSIGNED'); }} className={`chip whitespace-nowrap ${statusFilter === 'UNASSIGNED' ? 'chip-active' : ''}`}>No tailor ({counts.UNASSIGNED ?? 0})</button>
        {statuses.filter((s) => s !== 'AWAITING_REVIEW').map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); }} className={`chip whitespace-nowrap ${statusFilter === s ? 'chip-active' : ''}`}>{s.replace('_', ' ')} ({counts[s] ?? 0})</button>
        ))}
        {specialFilters.map((f) => (
          <button key={f} onClick={() => { setStatusFilter(f); }} className={`chip whitespace-nowrap ${statusFilter === f ? 'chip-active' : ''}`}>{f.replace('_', ' ')} ({counts[f] ?? 0})</button>
        ))}
        {paymentFilters.map((f) => (
          <button key={f.key} onClick={() => { setStatusFilter(f.key); }} className={`chip whitespace-nowrap ${statusFilter === f.key ? 'chip-active' : ''}`}>{f.label} ({counts[f.key] ?? 0})</button>
        ))}
      </div>
      <div className="border-b border-maroon-100 p-3 lg:hidden">
        <button type="button" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} aria-label="Orders filter kholen"
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-maroon-100 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-card">
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal size={16} className="shrink-0 text-maroon-700" />
            Filter
            <span className="truncate font-normal text-ink-muted">{filterOptions.find((f) => f.key === statusFilter)?.label}</span>
          </span>
          <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
        </button>
        {filterOpen ? (
          <div className="mt-2 grid gap-1">
            {filterOptions.map((f) => (
              <button key={f.key} type="button" onClick={() => { setStatusFilter(f.key); setFilterOpen(false); }}
                className={clsx('flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition', f.key === statusFilter ? 'bg-maroon-50 font-semibold text-maroon-700' : 'text-ink hover:bg-maroon-50')}>
                {f.label}
                {f.key === statusFilter ? <span className="h-2 w-2 rounded-full bg-maroon-600" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">Koi order nahi.</p>
        ) : filtered.map((order) => (
          <div key={order.orderNumber} role="button" tabIndex={0} aria-label={`Order ${order.orderNumber} kholen`}
            onClick={() => setSelected(order)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(order); } }}
            className="cursor-pointer rounded-2xl border border-maroon-100 bg-white p-3.5 text-left shadow-card transition hover:border-maroon-200 active:scale-[0.99]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-ink">{order.orderNumber}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
                  <span>{new Date(order.placedAt).toLocaleString('en-IN')}</span>
                  {order.isGuest ? <span className="rounded-full bg-ink-light/15 px-1.5 py-0.5 text-[9px] font-bold text-ink-light">GUEST</span> : null}
                </div>
              </div>
              <span className="shrink-0 text-base font-bold text-ink">{inr(order.amounts?.totalMinor ?? 0)}</span>
            </div>

            <div className="mt-2 min-w-0 text-sm">
              <div className="truncate font-semibold text-ink">{order.contact?.name ?? '—'}</div>
              <div className="mt-0.5 truncate text-ink-muted">{order.contact?.mobile ?? ''}</div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-ink-muted">{(order.items ?? []).reduce((n, i) => n + i.quantity, 0)} items</span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <Badge label={order.payment?.status ?? 'PENDING'} />
                <Badge label={order.status ?? ''} />
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-maroon-50 pt-2.5">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-maroon-700"><Eye size={14} />View order</span>
              <ChevronRight size={16} className="text-ink-light" />
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <OrderDetailModal order={selected} onClose={() => setSelected(null)} busy={busy}
          onStatus={(status) => updateStatus(selected, status)} onUpdated={reloadSelected} onListRefresh={load}
          setError={(msg) => setError(msg)} />
      ) : null}
    </section>
  );
}

function OrderDetailModal({ order, onClose, busy, onStatus, onUpdated, onListRefresh, setError }: {
  order: AdminOrder; onClose: () => void; busy: string; onStatus: (status: string) => void;
  onUpdated: () => Promise<void>; onListRefresh: () => void; setError: (msg: string) => void;
}) {
  const [shipForm, setShipForm] = useState(order.shipping ?? { shiprocketOrderId: '', shipmentId: '', awb: '', courier: '', trackingUrl: '', estimatedDeliveryAt: null });
  // Defensive defaults: legacy/test documents may be missing fields.
  const contact = order.contact ?? { name: order.orderNumber, mobile: '—', email: '' };
  const address = order.address ?? { line1: '', line2: '', city: '', state: '', pincode: '', country: '' };
  const items = order.items ?? [];
  const statusHistory = order.statusHistory ?? [];
  const payment = order.payment ?? { method: '—', status: '—', razorpayOrderId: '', razorpayPaymentId: '', failureReason: '', paidAt: null };
  const amounts = order.amounts ?? { subtotalMinor: 0, discountMinor: 0, shippingMinor: 0, totalMinor: 0, couponCode: '', codAdvanceMinor: 0, codBalanceMinor: 0 };
  const hasCustom = items.some((i) => i.type === 'CUSTOMIZE');
  const imrs = (v: number) => inr(v);
  const [preview, setPreview] = useState<string | null>(null);
  const reviewLocked = Boolean(order.status === 'CANCELLED' && order.cancellation?.refund?.status && order.cancellation.refund.status !== 'COMPLETED');
  const reviewOpen = order.status === 'AWAITING_REVIEW';

  const [complexity, setComplexity] = useState(order.production?.complexity ?? 'medium');
  const [promiseDate, setPromiseDate] = useState(toDateInput(order.promisedDeliveryAt));
  const [reviewNote, setReviewNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [refundBusy, setRefundBusy] = useState('');

  const confirmOrder = async () => {
    setReviewBusy('confirm');
    try {
      await api(`/admin/orders/${order.orderNumber}/confirm`, {
        method: 'POST',
        body: {
          reviewNote: reviewNote.trim(),
          complexity,
          estimatedDeliveryAt: promiseDate ? `${promiseDate}T00:00:00` : null,
        },
      });
      setReviewNote('');
      await onUpdated();
      onListRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Confirm nahi hua.'); }
    finally { setReviewBusy(''); }
  };

  const savePromise = async () => {
    setReviewBusy('promise');
    try {
      await api(`/admin/orders/${order.orderNumber}/promised-delivery`, {
        method: 'PATCH',
        body: { estimatedDeliveryAt: promiseDate ? `${promiseDate}T00:00:00` : null },
      });
      setReviewNote('');
      await onUpdated();
      onListRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Delivery date save nahi hua.'); }
    finally { setReviewBusy(''); }
  };

  const cancelOrder = async () => {
    if (!cancelReason.trim()) { setError('Cancel ka reason likhein.'); return; }
    setReviewBusy('cancel');
    try {
      await api(`/admin/orders/${order.orderNumber}/cancel`, { method: 'POST', body: { reason: cancelReason.trim() } });
      await onUpdated();
      onListRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Cancel nahi hua.'); }
    finally { setReviewBusy(''); }
  };

  const recomputeProduction = async (nextComplexity: string) => {
    setReviewBusy('production');
    try {
      await api(`/admin/orders/${order.orderNumber}/production`, { method: 'PATCH', body: { complexity: nextComplexity } });
      await onUpdated();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Estimate update nahi hua.'); }
    finally { setReviewBusy(''); }
  };

  const assignTailor = async (tailorId: string, notes: string, reason: string) => {
    setReviewBusy('assign');
    try {
      await api(`/admin/orders/${order.orderNumber}/assign-tailor`, { method: 'POST', body: { tailorId, notes, reason } });
      setAssignOpen(false);
      await onUpdated();
      onListRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Tailor assign nahi hua.'); }
    finally { setReviewBusy(''); }
  };

  const refundAction = async (action: 'retry' | 'sync') => {
    setRefundBusy(action);
    try {
      await api(`/admin/orders/${order.orderNumber}/refund/${action}`, { method: 'POST' });
      await onUpdated();
      onListRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Refund action fail hua.'); }
    finally { setRefundBusy(''); }
  };

  const saveShipping = async () => {
    void api(`/admin/orders/${order.orderNumber}/shipping`, { method: 'PATCH', body: shipForm })
      .then(async () => { await onUpdated(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Shipping update nahi hua.'))
      .finally();
  };

  return (
    <Modal open onClose={onClose} title={order.orderNumber} subtitle="Order detail, stitching sheet, payment aur shipping" maxWidth="sm:max-w-4xl"
      footer={<div className="flex justify-end gap-2"><BtnGhost onClick={onClose}><X size={15} />Close</BtnGhost></div>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700">Order status</h4>
            {hasCustom ? <span className="mt-1 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">CUSTOM ORDER</span> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge label={order.status} />
              {reviewOpen ? (
                <ReviewControls busy={reviewBusy} complexity={complexity} onComplexity={setComplexity}
                  note={reviewNote} onNote={setReviewNote} cancelReason={cancelReason} onCancelReason={setCancelReason}
                  promiseDate={promiseDate} onPromiseDate={setPromiseDate}
                  onConfirm={() => void confirmOrder()} onCancel={() => void cancelOrder()} />
              ) : (
                <select className="field min-h-10 w-auto py-2 text-sm" value={order.status} disabled={busy === order.orderNumber || reviewLocked}
                  onChange={(e) => onStatus(e.target.value)}>
                  {['PROCESSING', 'STITCHING', 'QUALITY_CHECK', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'FAILED'].map((s) => <option key={s}>{s}</option>)}
                </select>
              )}
            </div>
            {reviewLocked ? (
              <div className="mt-3 rounded-lg border border-alert/30 bg-alert/10 p-3 text-xs font-semibold text-alert">
                Ye order cancelled hai aur refund abhi settle nahi hua. Status change lock hai until refund completes.
              </div>
            ) : null}
            <ReviewBanner order={order} />
            <div className="mt-4 space-y-1.5">
              {statusHistory.map((h, i) => (
                <div className="flex items-start gap-2 text-xs" key={i}>
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-maroon-500" />
                  <span className="font-semibold">{h.status.replace('_', ' ')}</span>
                  <span className="text-ink-muted">{new Date(h.at).toLocaleString('en-IN')}</span>
                  {h.note ? <span className="text-ink-muted">— {h.note}</span> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700"><Scissors size={15} className="mr-1 inline" />Production & delivery estimate</h4>
            {order.production ? (
              <div className="mt-3 space-y-1.5 text-sm">
                <Row k="Complexity" v={
                  <span className="inline-flex items-center gap-2">
                    <select value={complexity} onChange={(e) => setComplexity(e.target.value)}
                      className="field min-h-8 w-auto py-1 text-xs" disabled={reviewBusy === 'production' || order.status === 'CANCELLED'}>
                      {complexityOptions.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                    <BtnGhost className="min-h-8 px-2 text-xs" onClick={() => void recomputeProduction(complexity)}
                      disabled={reviewBusy === 'production' || order.status === 'CANCELLED'}>
                      <RefreshCw size={13} />Recompute
                    </BtnGhost>
                  </span>
                } />
                <Row k="Stitching units" v={order.production.productionUnits} />
                <Row k="Stitching (working days)" v={order.production.estimatedWorkingDays} />
                {order.deliveryEstimate && (order.deliveryEstimate.fromDate || order.deliveryEstimate.toDate) ? (
                  <>
                    <Row k="Estimated delivery range" v={`${fmtDate(order.deliveryEstimate.fromDate)} → ${fmtDate(order.deliveryEstimate.toDate)}`} />
                    <Row k="Packing / shipping / buffer (days)" v={`${order.deliveryEstimate.packingWorkingDays} / ${order.deliveryEstimate.shippingDays} / ${order.deliveryEstimate.bufferDays}`} />
                  </>
                ) : null}
                {order.liveWorkload ? (
                  <Row k="Live workload / capacity" v={`${order.liveWorkload.activeUnits} units (${order.liveWorkload.activeOrders} orders) / ${order.liveWorkload.dailyCapacity} per day`} />
                ) : null}
                <Row k="Confirmed delivery date (customer ko dikhega)" v={
                  <span className="inline-flex items-center gap-2">
                    <input type="date" className="field min-h-8 w-auto py-1 text-xs" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} disabled={reviewBusy === 'promise' || order.status === 'CANCELLED'} />
                    <BtnGhost className="min-h-8 px-2 text-xs" onClick={() => void savePromise()} disabled={reviewBusy === 'promise' || order.status === 'CANCELLED'}><Check size={13} />Save</BtnGhost>
                  </span>
                } />
              </div>
            ) : <p className="mt-2 text-xs text-ink-muted">Confirm hote hi estimate banega.</p>}
          </section>

          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700"><UserRound size={15} className="mr-1 inline" />Tailor</h4>
            {order.tailor?.tailorName ? (
              <div className="mt-3 space-y-1.5 text-sm">
                <Row k="Tailor" v={order.tailor.tailorName} />
                <Row k="Assigned" v={order.tailor.assignedAt ? new Date(order.tailor.assignedAt).toLocaleString('en-IN') : '—'} />
                <Row k="Status" v={<Badge label={order.tailor.status} />} />
                {order.tailor.notes ? <Row k="Notes" v={order.tailor.notes} /> : null}
                {order.tailor.history?.length ? (
                  <div className="mt-2 space-y-1 border-t border-maroon-100 pt-2 text-xs text-ink-muted">
                    {order.tailor.history.map((h, i) => (
                      <div key={i}>· {h.tailorName}{h.reason ? ` — ${h.reason}` : ''}<span className="ml-1">{new Date(h.at).toLocaleDateString('en-IN')}</span></div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : <p className="mt-2 text-xs text-ink-muted">Tailor assign nahi hua.</p>}
            {['CONFIRMED', 'STITCHING', 'QUALITY_CHECK', 'PACKED'].includes(order.status) ? (
              <BtnOutline className="mt-3" onClick={() => setAssignOpen(true)} disabled={reviewBusy === 'assign'}>
                <UserRound size={15} />{order.tailor?.tailorName ? 'Reassign' : 'Assign tailor'}
              </BtnOutline>
            ) : null}
          </section>

          {order.cancellation ? (
            <section className="rounded-xl border border-maroon-100 p-4">
              <h4 className="text-sm font-bold text-maroon-700">Cancellation & refund</h4>
              <div className="mt-3 space-y-1.5 text-sm">
                <Row k="Cancelled at" v={order.cancellation.cancelledAt ? new Date(order.cancellation.cancelledAt).toLocaleString('en-IN') : '—'} />
                <Row k="Reason" v={order.cancellation.reason} />
                <Row k="Refund" v={<Badge label={order.cancellation.refund?.status ?? 'NONE'} />} />
                {(order.cancellation.refund?.amountMinor ?? 0) > 0 ? <Row k="Refund amount" v={imrs(order.cancellation.refund.amountMinor)} /> : null}
                {order.cancellation.refund?.razorpayRefundId ? <Row k="Razorpay refund" v={order.cancellation.refund.razorpayRefundId} /> : null}
                {order.cancellation.refund?.completedAt ? <Row k="Refunded at" v={new Date(order.cancellation.refund.completedAt).toLocaleString('en-IN')} /> : null}
                {order.cancellation.refund?.failureReason ? <Row k="Refund failure" v={order.cancellation.refund.failureReason} /> : null}
                {order.cancellation.notificationMessage ? <Row k="SMS" v={order.cancellation.notificationMessage} /> : null}
                {order.cancellation.refund && (order.cancellation.refund.status === 'FAILED' || (order.cancellation.refund.razorpayRefundId && order.cancellation.refund.status !== 'COMPLETED')) ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <BtnOutline className="min-h-8 px-2 text-xs" onClick={() => void refundAction('sync')} disabled={refundBusy !== ''}><RefreshCw size={14} />Sync</BtnOutline>
                    {order.cancellation.refund.status === 'FAILED' ? (
                      <BtnPrimary className="min-h-8 px-2 text-xs" onClick={() => void refundAction('retry')} disabled={refundBusy !== ''}>Retry refund</BtnPrimary>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700">Payment</h4>
            <div className="mt-3 space-y-1.5 text-sm">
              <Row k="Method" v={payment.method} />
              <Row k="Status" v={<Badge label={payment.status} />} />
              {payment.razorpayOrderId ? <Row k="Razorpay order" v={payment.razorpayOrderId} /> : null}
              {payment.razorpayPaymentId ? <Row k="Razorpay payment" v={payment.razorpayPaymentId} /> : null}
              {payment.failureReason ? <Row k="Failure" v={payment.failureReason} /> : null}
              {payment.paidAt ? <Row k="Paid at" v={new Date(payment.paidAt).toLocaleString('en-IN')} /> : null}
              {payment.method === 'COD' && (amounts.codAdvanceMinor ?? 0) > 0 ? (
                <>
                  <Row k="COD advance paid" v={imrs(amounts.codAdvanceMinor ?? 0)} />
                  <Row k="Balance at delivery" v={imrs(amounts.codBalanceMinor ?? 0)} />
                </>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700"><Truck size={15} className="mr-1 inline" />Shipping</h4>
            <div className="mt-3 grid gap-2">
              <Field label="Shiprocket order ID"><TextInput value={shipForm.shiprocketOrderId} onChange={(e) => setShipForm({ ...shipForm, shiprocketOrderId: e.target.value })} /></Field>
              <Field label="Shipment ID"><TextInput value={shipForm.shipmentId} onChange={(e) => setShipForm({ ...shipForm, shipmentId: e.target.value })} /></Field>
              <Field label="AWB number"><TextInput value={shipForm.awb} onChange={(e) => setShipForm({ ...shipForm, awb: e.target.value })} /></Field>
              <Field label="Courier"><TextInput value={shipForm.courier} onChange={(e) => setShipForm({ ...shipForm, courier: e.target.value })} /></Field>
              <Field label="Tracking URL"><TextInput value={shipForm.trackingUrl} onChange={(e) => setShipForm({ ...shipForm, trackingUrl: e.target.value })} /></Field>
              <BtnPrimary onClick={() => void saveShipping()}><Check size={15} />Update shipping</BtnPrimary>
            </div>
          </section>

          <ShiprocketPanel order={order} onUpdated={onUpdated} setError={setError} />
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-maroon-100 p-4">
            <h4 className="text-sm font-bold text-maroon-700">Customer & delivery</h4>
            <div className="mt-3 space-y-1.5 text-sm">
              <Row k="Name" v={contact.name} />
              <Row k="Mobile" v={contact.mobile} />
              {contact.email ? <Row k="Email" v={contact.email} /> : null}
              <Row k="Address" v={`${address.line1}${address.line2 ? `, ${address.line2}` : ''}, ${address.city}, ${address.state} ${address.pincode}, ${address.country}`} />
              {order.customerNote ? <Row k="Customer note" v={order.customerNote} /> : null}
            </div>
          </section>

          <section className="rounded-xl border border-maroon-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-maroon-700">Items & tailor sheet</h4>
                <p className="mt-1 text-xs text-ink-muted">Product, selected fabric/laces aur measurements ek jagah.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <BtnOutline className="min-h-9 px-2.5 text-xs" onClick={() => openPrintableOrder(order)}><Printer size={14} />Print / Save PDF</BtnOutline>
                <BtnOutline className="min-h-9 px-2.5 text-xs" onClick={() => downloadOrderImage(order)}><FileImage size={14} />Download image</BtnOutline>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {items.map((item, i) => {
                const unitBreakdown = (item.unitBaseMinor ?? 0) + (item.unitFabricMinor ?? 0) + (item.unitLaceMinor ?? 0) + (item.unitLatkanMinor ?? 0) + (item.unitStitchingMinor ?? 0);
                const unitMinor = unitBreakdown > 0 ? unitBreakdown : Math.round((item.lineTotalMinor ?? 0) / Math.max(1, item.quantity));
                const variant = [
                  item.colorName,
                  item.size ? `Size ${item.size}` : '',
                  item.fabricName,
                  item.sku ? `SKU ${item.sku}` : '',
                  item.laceNames?.length ? `Laces: ${item.laceNames.join(', ')}` : '',
                  item.latkanNames?.length ? `Latkan: ${item.latkanNames.join(', ')}` : '',
                ].filter(Boolean).join(' · ');
                return (
                  <div className="rounded-lg border border-maroon-50 p-3" key={i}>
                    <div className="flex gap-3">
                    <button type="button" onClick={() => { if (item.image) setPreview(item.image); }} title={item.image ? 'Image preview' : 'No image'}
                      className={`h-20 w-16 shrink-0 ${item.image ? 'cursor-zoom-in bg-maroon-50' : 'cursor-default bg-ink-light/10'} grid place-items-center overflow-hidden rounded-lg text-ink-light`}>
                      {item.image ? <img src={cloudinarySrc(item.image, 128)} alt={item.name} loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon size={18} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{item.designId}<span className="ml-2 text-xs font-normal text-ink-muted">{item.name}</span></p>
                          {variant ? <p className="mt-0.5 text-xs text-ink-muted">{variant}</p> : null}
                        </div>
                        <span className="shrink-0 font-semibold">{imrs(item.lineTotalMinor)}</span>
                      </div>
                      <div className="mt-1 text-xs text-ink-muted">
                        Qty <strong className="text-ink">{item.quantity}</strong> × selling price {imrs(unitMinor)} each
                      </div>
                    </div>
                    </div>
                    <OptionSnapshots label="Fabric" items={item.fabricDetails} fallback={item.fabricName} onPreview={setPreview} />
                    <OptionSnapshots label="Laces" items={item.laceDetails} fallback={item.laceNames?.join(', ')} onPreview={setPreview} />
                    <OptionSnapshots label="Latkans" items={item.latkanDetails} fallback={item.latkanNames?.join(', ')} onPreview={setPreview} />
                    {item.measurement ? (
                      <div className="mt-3 rounded-md bg-maroon-50/60 p-3 text-xs">
                        <p className="font-bold text-maroon-700">Measurements ({item.measurement.unit})</p>
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                          {Object.entries(item.measurement.values).map(([k, v]) => <span key={k}><strong className="capitalize">{k.replace(/_/g, ' ')}</strong>: {v}</span>)}
                        </div>
                      </div>
                    ) : <p className="mt-3 text-xs text-ink-muted">Measurements saved nahi hain.</p>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 space-y-1 border-t border-maroon-100 pt-3 text-sm">
              <Row k="Subtotal" v={imrs(amounts.subtotalMinor)} />
              {amounts.couponCode ? <Row k={`Discount (${amounts.couponCode})`} v={`-${imrs(amounts.discountMinor)}`} /> : <Row k="Discount" v={`-${imrs(amounts.discountMinor)}`} />}
              <Row k="Shipping" v={imrs(amounts.shippingMinor)} />
              <Row k={<strong>Total ({order.currency ?? 'INR'})</strong>} v={<strong>{imrs(amounts.totalMinor)}</strong>} />
            </div>
          </section>
        </div>
      </div>
      <TailorAssignModal open={assignOpen} onClose={() => setAssignOpen(false)} onAssign={assignTailor} busy={reviewBusy === 'assign'} />
      {preview ? <ImageLightbox url={preview} alt="Product image" onClose={() => setPreview(null)} /> : null}
    </Modal>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink-muted">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function OptionSnapshots({ label, items, fallback, onPreview }: {
  label: string; items?: OrderOptionSnapshot[]; fallback?: string; onPreview: (url: string) => void;
}) {
  const snapshots = items?.filter((item) => item.name || item.image) ?? [];
  if (snapshots.length === 0 && !fallback) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-bold text-maroon-700">{label}</p>
      {snapshots.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {snapshots.map((option, index) => (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-maroon-50 bg-white p-1.5 pr-2" key={`${option.name}-${index}`}>
              <button type="button" onClick={() => option.image && onPreview(option.image)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-maroon-50" title={option.image ? `${label} image preview` : 'No image'}>
                {option.image ? <img src={cloudinarySrc(option.image, 96)} alt={option.name || label} loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon size={15} />}
              </button>
              <span className="max-w-[150px] text-xs font-semibold text-ink">
                {option.name || 'Unnamed'}
                {option.material || option.colorName ? <span className="block font-normal text-ink-muted">{[option.material, option.colorName].filter(Boolean).join(' · ')}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : <p className="mt-1 text-xs text-ink-muted">{fallback}</p>}
    </div>
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function printableOptions(label: string, options: OrderOptionSnapshot[] | undefined, fallback?: string): string {
  const values = options?.filter((option) => option.name || option.image) ?? [];
  if (values.length === 0) return fallback ? `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(fallback)}</p>` : '';
  return `<div><b>${escapeHtml(label)}</b><div class="options">${values.map((option) => `<div class="option">${option.image ? `<img src="${escapeHtml(cloudinarySrc(option.image, 96))}" alt="">` : ''}<span>${escapeHtml(option.name)}${option.material || option.colorName ? `<small>${escapeHtml([option.material, option.colorName].filter(Boolean).join(' · '))}</small>` : ''}</span></div>`).join('')}</div></div>`;
}

function printableOrderHtml(order: AdminOrder): string {
  const items = order.items ?? [];
  const customerAddress = [order.address?.line1, order.address?.line2, order.address?.city, order.address?.state, order.address?.pincode, order.address?.country]
    .filter(Boolean)
    .join(', ');

  const itemMarkup = items.map((item) => {
    const itemImage = item.image ? `<img src="${escapeHtml(cloudinarySrc(item.image, 400))}" alt="${escapeHtml(item.name || item.designId)}">` : '';
    const itemOptions = [
      printableOptions('Fabric', item.fabricDetails, item.fabricName),
      printableOptions('Laces', item.laceDetails, item.laceNames?.join(', ')),
      printableOptions('Latkans', item.latkanDetails, item.latkanNames?.join(', ')),
    ].join('');

    const measurementMarkup = item.measurement ? `
      <div class="measure">
        <b>Measurements (${escapeHtml(item.measurement.unit)})</b>
        <div class="measure-grid">
          ${Object.entries(item.measurement.values).map(([key, value]) => `<span><b>${escapeHtml(key.replace(/_/g, ' '))}:</b> ${escapeHtml(String(value))}</span>`).join('')}
        </div>
      </div>
    ` : '';

    return `
      <section class="item">
        <div class="product">
          ${itemImage}
          <div class="details">
            <div class="name">${escapeHtml(item.name || item.designId)} <span class="muted">(${escapeHtml(item.designId)})</span></div>
            <p class="muted">${escapeHtml([item.colorName, item.size ? `Size ${item.size}` : '', item.sku ? `SKU ${item.sku}` : ''].filter(Boolean).join(' · '))}</p>
            ${itemOptions}
            <p><b>Quantity:</b> ${escapeHtml(String(item.quantity ?? 0))}</p>
            ${measurementMarkup}
          </div>
        </div>
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(order.orderNumber)} tailor details</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        font-family: Arial, sans-serif;
        color: #2b2220;
      }
      body {
        display: flex;
        justify-content: center;
        padding: 18px;
      }
      .sheet {
        width: 100%;
        max-width: 980px;
        min-height: 1122px;
        background: #fff;
      }
      h1 { color: #741d3c; margin: 0 0 4px; font-size: 34px; }
      h2 {
        font-size: 24px; color: #741d3c; margin: 26px 0 10px; border-bottom: 2px solid #ead6dc; padding-bottom: 8px;
      }
      .muted { color: #6b5c56; font-size: 18px; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #741d3c; padding-bottom: 18px; }
      .contact { margin: 20px 0; padding: 16px; background: #fbf4f6; border-radius: 12px; font-size: 18px; line-height: 1.6; }
      .item { border: 2px solid #ead6dc; border-radius: 14px; padding: 22px; margin: 22px 0; page-break-inside: avoid; }
      .product { display: flex; gap: 28px; align-items: flex-start; }
      .product > img { width: 240px; height: 300px; object-fit: cover; border-radius: 12px; }
      .name { font-size: 30px; font-weight: bold; }
      .details { flex: 1; font-size: 18px; }
      .options { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 16px; }
      .option { display: flex; align-items: center; gap: 10px; border: 1px solid #ead6dc; border-radius: 10px; padding: 10px; font-size: 17px; }
      .option img { width: 82px; height: 82px; object-fit: cover; border-radius: 9px; }
      .option small { display: block; color: #6b5c56; margin-top: 5px; }
      .measure { background: #fbf4f6; border-radius: 12px; padding: 14px; margin-top: 14px; }
      .measure-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; font-size: 16px; margin-top: 10px; }
      .footer { margin-top: 30px; border-top: 2px solid #ead6dc; padding-top: 14px; font-size: 16px; color: #6b5c56; }

      @media (max-width: 640px) {
        body { padding: 10px; }
        .sheet { min-height: auto; }
        .top { flex-direction: column; gap: 10px; }
        h1 { font-size: 28px; }
        h2 { font-size: 22px; }
        .muted { font-size: 15px; }
        .contact { font-size: 15px; }
        .item { padding: 14px; }
        .product { flex-direction: column; gap: 14px; }
        .product > img { width: 100%; height: 260px; }
        .name { font-size: 24px; }
        .details { font-size: 15px; }
        .option { width: 100%; }
        .option img { width: 64px; height: 64px; }
        .measure-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }

      @media print {
        body { padding: 0; }
        .sheet { max-width: none; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="top">
        <div>
          <h1>Guddi Silai</h1>
          <div class="muted">Tailor order details</div>
        </div>
        <div>
          <b>${escapeHtml(order.orderNumber)}</b><br>
          <span class="muted">${escapeHtml(new Date(order.placedAt).toLocaleString('en-IN'))}</span>
        </div>
      </div>

      <div class="contact">
        <b>${escapeHtml(order.contact?.name ?? '')}</b> · ${escapeHtml(order.contact?.mobile ?? '')}${order.contact?.email ? ` · ${escapeHtml(order.contact.email)}` : ''}<br>
        ${escapeHtml(customerAddress)}
      </div>

      <h2>Items</h2>
      ${itemMarkup}

      <div class="footer">
        Customer note: ${escapeHtml(order.customerNote || '—')}<br>
        Generated from admin order detail.
      </div>
    </div>
  </body>
</html>`;
}
function openPrintableOrder(order: AdminOrder) {
  // No `noopener`/`noreferrer` in the features string: those make
  // `window.open` return `null`, so the print window would never open.
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const html = printableOrderHtml(order);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for the window (and its images) to finish loading before printing,
  // otherwise the print dialog can capture a partially-rendered / blank page.
  const printWhenReady = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // Print popup blocked — the generated document stays open for Save as PDF.
    }
  };

  const images = Array.from(printWindow.document.images);
  const pending = images.filter((img) => !img.complete);
  if (pending.length === 0) {
    setTimeout(printWhenReady, 120);
    return;
  }

  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    setTimeout(printWhenReady, 120);
  };
  pending.forEach((img) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
  // Hard timeout so the print dialog always fires even if an image hangs.
  setTimeout(done, 4000);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function downloadOrderImage(order: AdminOrder) {
  const baseHtml = printableOrderHtml(order);
  const styleCss = baseHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  let bodyHtml = baseHtml.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
  bodyHtml = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Inline every image as a data-URI so the exported PNG isn't blank:
  // Cloudinary images are cross-origin and would both taint the canvas and
  // fail to load inside a bare SVG raster.
  const srcs = Array.from(new Set(Array.from(bodyHtml.matchAll(/<img[^>]+src="([^"]+)"/g)).map((m) => m[1])));
  const inlined = new Map<string, string>();
  await Promise.all(srcs.map(async (src) => {
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) return;
      inlined.set(src, await blobToDataUri(await res.blob()));
    } catch {
      // Keep original src — it may still render when opened in a browser.
    }
  }));
  for (const [src, dataUri] of inlined) bodyHtml = bodyHtml.split(src).join(dataUri);

  // <style> must live INSIDE the foreignObject div so the SVG carries the CSS.
  const cleanBody = bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
  const styledBody = `<style>${styleCss}</style>${cleanBody}`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
      <foreignObject width="1200" height="1800">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff;padding:36px;font-family:Arial,sans-serif;color:#2b2220;box-sizing:border-box;line-height:1.4;">
          ${styledBody}
        </div>
      </foreignObject>
    </svg>
  `;

  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    // Rasterize the SVG (with its inlined images / styles) to a real PNG.
    const img = new Image();
    img.src = svgUrl;
    const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('image render timeout')), 6000);
      img.onload = () => {
        clearTimeout(timer);
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 1200;
        c.height = img.naturalHeight || 1800;
        c.getContext('2d')?.drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = () => { clearTimeout(timer); reject(new Error('svg failed to render')); };
    });

    const pngUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = `${order.orderNumber}-tailor-details.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    // Fallback: if rasterization is unsupported, save the styled SVG instead.
    const link = document.createElement('a');
    link.href = svgUrl;
    link.download = `${order.orderNumber}-tailor-details.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  setTimeout(() => URL.revokeObjectURL(svgUrl), 3000);
}

const srTones: Record<string, string> = {
  NOT_SHIPPED: 'bg-ink-light/20 text-ink-muted',
  SHIPMENT_CREATED: 'bg-maroon-100 text-maroon-700',
  AWB_ASSIGNED: 'bg-cyan-100 text-cyan-700',
  PICKUP_SCHEDULED: 'bg-marigold-100 text-ink',
  SHIPPED: 'bg-blue-100 text-blue-700',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-purple-100 text-purple-700',
  DELIVERED: 'bg-leaf/15 text-leaf',
  CANCELLED: 'bg-alert/10 text-alert',
  SHIPMENT_CREATION_FAILED: 'bg-alert/10 text-alert',
};

function SrBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold whitespace-nowrap ${srTones[status] ?? 'bg-maroon-50 text-maroon-700'}`}>{status.replace(/_/g, ' ')}</span>;
}

interface CourierOption { courierId: string; name: string; rate: number | null; estimatedDays: number | null }

function ShiprocketPanel({ order, onUpdated, setError }: {
  order: AdminOrder; onUpdated: () => Promise<void>; setError: (msg: string) => void;
}) {
  const s = order.shipping ?? ({} as AdminOrder['shipping']);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [courierOpen, setCourierOpen] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [manualCourier, setManualCourier] = useState('');

  const hasShipment = Boolean(s.shiprocketOrderId);
  const hasAwb = Boolean(s.awb);
  const terminal = s.status === 'CANCELLED' || s.status === 'DELIVERED';

  const run = async <T,>(key: string, fn: () => Promise<T>) => {
    setBusy(key);
    setMsg('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Shiprocket action fail hua.');
    } finally {
      setBusy('');
    }
  };

  const create = async () => {
    await run('create', async () => {
      const res = await api<{ result?: { mock?: boolean; message?: string } }>(
        `/admin/orders/${order.orderNumber}/shiprocket/create`,
        { method: 'POST' },
      );
      setMsg(res.result?.message ?? 'Shipment create ho gaya.');
      await onUpdated();
    });
  };

  const openCouriers = async () => {
    setMsg('');
    try {
      const res = await api<{ couriers: CourierOption[] }>(`/admin/orders/${order.orderNumber}/shiprocket/recommend`);
      setCouriers(res.couriers);
      setChosen(0);
      setManualCourier('');
      setCourierOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Courier list nahi mili.');
    }
  };

  const assignAwb = async () => {
    const courierId = couriers[chosen]?.courierId ?? manualCourier.trim();
    if (!courierId) { setMsg('Pehle courier select karein ya courier id likhein.'); return; }
    await run('awb', async () => {
      const res = await api<{ result?: { awb: string; message?: string } }>(`/admin/orders/${order.orderNumber}/shiprocket/awb`, {
        method: 'POST',
        body: { courierId, courierName: couriers[chosen]?.name },
      });
      setCourierOpen(false);
      setMsg(`AWB ${res.result?.awb} assign ho gaya.`);
      await onUpdated();
    });
  };

  const pickup = async () => {
    await run('pickup', async () => {
      await api(`/admin/orders/${order.orderNumber}/shiprocket/pickup`, { method: 'POST' });
      setMsg('Pickup schedule ho gaya.');
      await onUpdated();
    });
  };

  const label = async () => {
    await run('label', async () => {
      const res = await api<{ labelUrl: string; message?: string }>(`/admin/orders/${order.orderNumber}/shiprocket/label`, { method: 'POST' });
      if (res.labelUrl) { window.open(res.labelUrl, '_blank', 'noopener'); setMsg('Label khol diya — print kar lein.'); }
      else setMsg(res.message ?? 'Label nahi mila.');
    });
  };

  const sync = async () => {
    await run('sync', async () => {
      const res = await api<{ tracking: { status: string; statusText: string } }>(`/admin/orders/${order.orderNumber}/shiprocket/sync`, { method: 'POST' });
      setMsg(`Tracking: ${res.tracking.status.replace(/_/g, ' ')} — ${res.tracking.statusText.split('\n')[0]}`);
      await onUpdated();
    });
  };

  const cancel = async () => {
    if (!window.confirm('Shipment cancel karna hai? Ye wapas nahi hoga.')) return;
    await run('cancel', async () => {
      await api(`/admin/orders/${order.orderNumber}/shiprocket/cancel`, { method: 'POST' });
      setMsg('Shipment cancel ho gaya.');
      await onUpdated();
    });
  };

  return (
    <section className="rounded-xl border border-maroon-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-maroon-700">Shiprocket controls</h4>
        <SrBadge status={s.status || 'NOT_SHIPPED'} />
      </div>

      <div className="mt-3 space-y-2 text-xs text-ink-muted">
        {s.shiprocketOrderId ? <Row k="Shiprocket order" v={s.shiprocketOrderId} /> : null}
        {s.shipmentId ? <Row k="Shipment ID" v={s.shipmentId} /> : null}
        {s.awb ? <Row k="AWB" v={s.awb} /> : null}
        {s.courier ? <Row k="Courier" v={s.courier} /> : null}
        {s.statusText ? <Row k="Last status" v={s.statusText.split('\n')[0]} /> : null}
        {s.estimatedDeliveryAt ? <Row k="ETA" v={new Date(s.estimatedDeliveryAt).toLocaleDateString('en-IN')} /> : null}
        {s.lastSyncedAt ? <Row k="Last synced" v={new Date(s.lastSyncedAt).toLocaleString('en-IN')} /> : null}
        {s.trackingUrl ? (
          <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-maroon-700">
            <LinkIcon size={13} /> Open tracking
          </a>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <BtnPrimary type="button" onClick={() => void create()} disabled={busy !== '' || hasShipment || terminal}>
          {busy === 'create' ? 'Creating...' : 'Create shipment'}
        </BtnPrimary>
        <BtnOutline type="button" onClick={() => void openCouriers()} disabled={busy !== '' || !hasShipment || hasAwb || terminal}>
          {busy === 'awb' ? 'Assigning...' : 'Assign AWB'}
        </BtnOutline>
        <BtnOutline type="button" onClick={() => void pickup()} disabled={busy !== '' || !hasAwb || terminal || s.status === 'PICKUP_SCHEDULED'}>
          {busy === 'pickup' ? 'Scheduling...' : 'Schedule pickup'}
        </BtnOutline>
        <BtnOutline type="button" onClick={() => void label()} disabled={busy !== '' || !hasShipment}>
          {busy === 'label' ? 'Generating...' : 'Label'}
        </BtnOutline>
        <BtnOutline type="button" onClick={() => void sync()} disabled={busy !== '' || (!hasShipment && !s.shipmentId && !s.awb)}>
          {busy === 'sync' ? 'Syncing...' : 'Sync tracking'}
        </BtnOutline>
        <BtnGhost type="button" onClick={() => void cancel()} disabled={busy !== '' || (!hasShipment && !s.shipmentId) || terminal}>
          {busy === 'cancel' ? 'Cancelling...' : 'Cancel shipment'}
        </BtnGhost>
      </div>
      {msg ? <p className="mt-2 text-xs font-medium text-ink-muted">{msg}</p> : null}
      <p className="mt-2 text-[11px] text-ink-muted">Buttons sirf tabhi active hain jab real step ho. Shipment create hone par AWB assign karna padta hai; pickup ke baad customer ko tracking milti hai.</p>

      <CourierModal open={courierOpen} onClose={() => setCourierOpen(false)} couriers={couriers} chosen={chosen}
        onChoose={setChosen} manual={manualCourier} onManual={setManualCourier} onAssign={() => void assignAwb()} busy={busy === 'awb'} />
    </section>
  );
}

function CourierModal({ open, onClose, couriers, chosen, onChoose, manual, onManual, onAssign, busy }: {
  open: boolean; onClose: () => void; couriers: CourierOption[]; chosen: number; onChoose: (i: number) => void;
  manual: string; onManual: (v: string) => void; onAssign: () => void; busy: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Courier select karein" subtitle="Recommended couriers (Shiprocket) se pick karein, ya manual courier ID likhein" maxWidth="sm:max-w-md">
      <div className="space-y-2">
        {couriers.length === 0 ? (
          <p className="text-sm text-ink-muted">Koi recommended courier nahi mili — manual courier ID use karein.</p>
        ) : couriers.map((c, i) => (
          <button type="button" key={c.courierId} onClick={() => onChoose(i)}
            className={`w-full rounded-xl border p-3 text-left text-sm ${i === chosen ? 'border-maroon-500 bg-maroon-50/60' : 'border-ink-light/30'}`}>
            <span className="font-semibold">{c.name}</span>
            <span className="ml-2 text-xs text-ink-muted">{c.rate ? `₹${c.rate}` : ''}{c.estimatedDays ? ` · ~${c.estimatedDays} days` : ''}</span>
          </button>
        ))}
        <Field label="Manual courier ID (optional)">
          <TextInput value={manual} onChange={(e) => onManual(e.target.value)} placeholder="e.g. 1234" />
        </Field>
        <BtnPrimary className="w-full" type="button" onClick={onAssign} disabled={busy}>{busy ? 'Assigning AWB...' : 'Assign AWB'}</BtnPrimary>
      </div>
    </Modal>
  );
}

const complexityOptions = ['simple', 'medium', 'designer', 'heavy_designer', 'bridal'];

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString('en-IN') : '—';
}

function toDateInput(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ReviewBanner({ order }: { order: AdminOrder }) {
  const flags = order.risk?.flagLabels ?? [];
  if (flags.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-alert/30 bg-alert/10 p-3 text-xs">
      <p className="font-bold text-alert">Review Recommended — Suspicious Signals</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {flags.map((f, i) => <span key={i} className="rounded-full bg-alert/10 px-2 py-0.5 font-semibold text-alert">{f}</span>)}
      </div>
      {order.customerStats ? (
        <p className="mt-1.5 text-ink-muted">Pehle {order.customerStats.previousOrders} order, {order.customerStats.previousCancelled} cancelled (30 din).</p>
      ) : null}
    </div>
  );
}

function ReviewControls({ busy, complexity, onComplexity, note, onNote, cancelReason, onCancelReason, promiseDate, onPromiseDate, onConfirm, onCancel }: {
  busy: string; complexity: string; onComplexity: (v: string) => void;
  note: string; onNote: (v: string) => void; cancelReason: string; onCancelReason: (v: string) => void;
  promiseDate: string; onPromiseDate: (v: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const canCancel = cancelReason.trim().length >= 3;

  return (
    <div className="w-full space-y-3">
      <div className="rounded-lg border border-maroon-100 bg-maroon-50/40 p-2 text-[11px] font-medium text-ink-muted">
        Review ho chuki order ko confirm karen, ya reason ke saath cancel karein. Cancel ke liye minimum 3 characters ka reason zaroori hai.
      </div>
      <div className="grid gap-2 rounded-lg bg-maroon-50/50 p-3 sm:grid-cols-2">
        <Field label="Complexity (production plan)">
          <select className="field min-h-10 w-full text-sm" value={complexity} onChange={(e) => onComplexity(e.target.value)}>
            {complexityOptions.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Review note (optional)">
          <TextInput value={note} onChange={(e) => onNote(e.target.value)} placeholder="Approve note" />
        </Field>
        <Field label="Estimated delivery date (customer ko dikhega)">
          <input type="date" className="field min-h-10 w-full text-sm" value={promiseDate} onChange={(e) => onPromiseDate(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BtnPrimary onClick={onConfirm} disabled={busy === 'confirm'}><Check size={15} />{busy === 'confirm' ? 'Confirming...' : 'Confirm order'}</BtnPrimary>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TextInput value={cancelReason} onChange={(e) => onCancelReason(e.target.value)} placeholder="Cancel ka reason (zaroori)" />
          <BtnGhost onClick={onCancel} disabled={busy === 'cancel' || !canCancel} className="shrink-0"><X size={15} />{busy === 'cancel' ? '...' : 'Cancel'}</BtnGhost>
        </div>
      </div>
    </div>
  );
}

interface TailorOption {
  _id: string; name: string; status: string;
  specializationCaps: Array<{ code: string; capacityPerDay: number }>;
  workload: { assignedOrders: number; assignedUnits: number };
}

function TailorAssignModal({ open, onClose, onAssign, busy }: {
  open: boolean; onClose: () => void; onAssign: (tailorId: string, notes: string, reason: string) => void; busy: boolean;
}) {
  const [tailors, setTailors] = useState<TailorOption[]>([]);
  const [chosen, setChosen] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setMsg('');
    void api<{ tailors: Array<{ tailor: TailorOption; workload: TailorOption['workload'] }> }>('/admin/tailor-dashboard')
      .then((res) => {
        const all = res.tailors.map((row) => ({ ...row.tailor, workload: row.workload }));
        const active = all.filter((t) => t.status === 'ACTIVE');
        setTailors(active);
        setChosen(active[0]?._id ?? '');
        setNotes('');
        setReason('');
      })
      .catch((err) => setMsg(err instanceof ApiError ? err.message : 'Tailor list nahi mili.'));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Tailor assign karein" subtitle="Manual assignment — history save hogi" maxWidth="sm:max-w-lg">
      <div className="space-y-2">
        {tailors.length === 0 ? (
          <p className="text-sm text-ink-muted">Koi ACTIVE tailor nahi. Pehle Tailors tab se add karein.</p>
        ) : tailors.map((t) => (
          <button type="button" key={t._id} onClick={() => setChosen(t._id)}
            className={`w-full rounded-xl border p-3 text-left text-sm ${chosen === t._id ? 'border-maroon-500 bg-maroon-50/60' : 'border-ink-light/30'}`}>
            <span className="font-semibold">{t.name}</span>
            <span className="ml-2 text-xs text-ink-muted">{t._id.slice(-6)}</span>
            <div className="mt-1 text-xs text-ink-muted">
              Load: {t.workload.assignedOrders} orders / {t.workload.assignedUnits} units · Caps: {t.specializationCaps.map((c) => `${c.code} ${c.capacityPerDay}/day`).join(', ') || '—'}
            </div>
          </button>
        ))}
        <Field label="Notes (optional)">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Reason (reassign ke liye)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {msg ? <p className="text-xs font-medium text-ink-muted">{msg}</p> : null}
        <BtnPrimary className="w-full" type="button" disabled={busy || chosen === ''} onClick={() => onAssign(chosen, notes, reason)}>
          {busy ? 'Assigning...' : 'Assign'}
        </BtnPrimary>
      </div>
    </Modal>
  );
}