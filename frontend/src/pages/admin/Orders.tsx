import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnOutline, BtnPrimary, Field, ImageLightbox, Modal, TextInput, Toolbar, inr } from './shared';
import { Eye, X, Check, Truck, Wallet, LinkIcon, Image as ImageIcon } from 'lucide-react';

const statuses = ['PLACED', 'CONFIRMED', 'PROCESSING', 'STITCHING', 'QUALITY_CHECK', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED'];

interface AdminOrder {
  _id: string; orderNumber: string; status: string; isGuest: boolean;
  contact: { name: string; mobile: string; email: string };
  address: { line1: string; line2: string; city: string; state: string; pincode: string; country: string };
  currency: string; amounts: { subtotalMinor: number; discountMinor: number; shippingMinor: number; totalMinor: number; couponCode: string; codAdvanceMinor?: number; codBalanceMinor?: number };
  payment: { method: string; status: string; razorpayOrderId: string; razorpayPaymentId: string; paidAt: string | null; failureReason: string };
  items: Array<{ designId: string; name: string; type: string; quantity: number; colorName: string; size: number | null; sku?: string; fabricName: string; laceNames: string[]; latkanNames?: string[]; measurement: { unit: string; values: Record<string, number> } | null; lineTotalMinor: number; image: string; unitBaseMinor?: number; unitFabricMinor?: number; unitLaceMinor?: number; unitLatkanMinor?: number; unitStitchingMinor?: number }>;
  statusHistory: Array<{ status: string; at: string; note: string }>;
  shipping: {
    provider: string; shiprocketOrderId: string; shipmentId: string; awb: string; courier: string; courierId: string;
    trackingUrl: string; estimatedDeliveryAt: string | null;
    status: string; statusText: string; lastSyncedAt: string | null; pickupScheduledAt: string | null; shippedAt: string | null; deliveredAt: string | null;
  };
  customerNote: string; placedAt: string;
}

export function OrdersModule() {
  const [items, setItems] = useState<AdminOrder[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await api<{ items: AdminOrder[] }>(`/admin/orders?${params.toString()}`);
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Orders load nahi hue.'); }
  };
  useEffect(() => { void load(); }, [statusFilter]);

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
    return map;
  }, [items]);

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Order management" count={filtered.length} searchPlaceholder="Order ID, customer, mobile" query={query} onQuery={search} />
      <div className="flex gap-2 overflow-x-auto px-2 py-3">
        <button onClick={() => { setStatusFilter('ALL'); }} className={`chip whitespace-nowrap ${statusFilter === 'ALL' ? 'chip-active' : ''}`}>All ({items.length})</button>
        {statuses.map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); }} className={`chip whitespace-nowrap ${statusFilter === s ? 'chip-active' : ''}`}>{s.replace('_', ' ')} ({counts[s] ?? 0})</button>
        ))}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Order</th><th className="p-4">Customer</th><th className="p-4">Items</th><th className="p-4">Amount</th><th className="p-4">Payment</th><th className="p-4">Status</th><th className="p-4">View</th></tr></thead>
          <tbody>{filtered.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={7}>Koi order nahi.</td></tr> : filtered.map((order) => (
            <tr className="border-t border-maroon-100 hover:bg-maroon-50/30" key={order.orderNumber}>
              <td className="p-4"><strong>{order.orderNumber}</strong>
                <div className="text-xs text-ink-muted">{new Date(order.placedAt).toLocaleString('en-IN')}</div>
                {order.isGuest ? <span className="text-[10px] font-bold text-ink-light">GUEST</span> : null}
              </td>
              <td className="p-4">{order.contact?.name ?? '—'}<div className="text-xs text-ink-muted">{order.contact?.mobile ?? ''}</div></td>
              <td className="p-4">{(order.items ?? []).reduce((n, i) => n + i.quantity, 0)}</td>
              <td className="p-4 font-semibold">{inr(order.amounts?.totalMinor ?? 0)}</td>
              <td className="p-4"><Badge label={order.payment?.status ?? 'PENDING'} /><div className="mt-1 text-xs text-ink-muted">{order.payment?.method ?? ''}</div></td>
              <td className="p-4"><Badge label={order.status ?? ''} /></td>
              <td className="p-4"><BtnGhost className="min-h-9 px-2.5" onClick={() => void setSelected(order)}><Eye size={15} /></BtnGhost></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {selected ? (
        <OrderDetailModal order={selected} onClose={() => setSelected(null)} busy={busy}
          onStatus={(status) => updateStatus(selected, status)} onUpdated={reloadSelected}
          setError={(msg) => setError(msg)} />
      ) : null}
    </section>
  );
}

function OrderDetailModal({ order, onClose, busy, onStatus, onUpdated, setError }: {
  order: AdminOrder; onClose: () => void; busy: string; onStatus: (status: string) => void; onUpdated: () => Promise<void>; setError: (msg: string) => void;
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
              <select className="field min-h-10 w-auto py-2 text-sm" value={order.status} disabled={busy === order.orderNumber} onChange={(e) => onStatus(e.target.value)}>
                {statuses.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
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
            <h4 className="text-sm font-bold text-maroon-700">Items</h4>
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
                  <div className="flex gap-3 rounded-lg border border-maroon-50 p-3" key={i}>
                    <button type="button" onClick={() => { if (item.image) setPreview(item.image); }} title={item.image ? 'Image preview' : 'No image'}
                      className={`h-20 w-16 shrink-0 ${item.image ? 'cursor-zoom-in bg-maroon-50' : 'cursor-default bg-ink-light/10'} grid place-items-center overflow-hidden rounded-lg text-ink-light`}>
                      {item.image ? <img src={item.image} alt={item.name} loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon size={18} />}
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
                      {item.type === 'CUSTOMIZE' && item.measurement ? (
                        <div className="mt-2 rounded-md bg-maroon-50/60 p-2 text-xs">
                          <p className="font-bold text-maroon-700">Measurements ({item.measurement.unit})</p>
                          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
                            {Object.entries(item.measurement.values).map(([k, v]) => <span key={k}><strong className="capitalize">{k.replace(/_/g, ' ')}</strong>: {v}"</span>)}
                          </div>
                        </div>
                      ) : null}
                    </div>
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
            {hasCustom ? <BtnPrimary className="mt-4 w-full" onClick={() => window.print()}><Wallet size={16} />Print stitching sheet</BtnPrimary> : null}
          </section>
        </div>
      </div>
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