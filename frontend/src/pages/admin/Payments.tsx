import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, Empty, Toolbar, inr } from './shared';
import { CreditCard, IndianRupee, XCircle, RotateCcw } from 'lucide-react';
import { SettingsForm, type SettingDef } from './Settings';

interface PaymentInfo { status: string; method: string; razorpayOrderId: string; razorpayPaymentId: string; failureReason: string; paidAt: string | null }
interface OrderRow { orderNumber: string; placedAt: string; amounts: { totalMinor: number }; customerNote?: string; payment: PaymentInfo }

const razorpayDefs: SettingDef[] = [
  { key: 'razorpayKeyId', label: 'Razorpay Key ID', type: 'text' },
  { key: 'razorpayKeySecret', label: 'Razorpay Key Secret', hint: 'Sirf test/self account ke liye yahan rakhein — production secret ko environment variable mein rakna zyada secure hai.', type: 'text' },
];

export function PaymentsModule() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    void api<{ items: OrderRow[] }>('/admin/orders')
      .then((res) => setOrders(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Payments load nahi hue.'));
  }, []);

  const counts: Record<string, { count: number; total: number }> = {};
  for (const order of orders) {
    const st = order.payment?.status ?? 'PENDING';
    (counts[st] ??= { count: 0, total: 0 });
    counts[st].count += 1;
    counts[st].total += order.amounts?.totalMinor ?? 0;
  }
  const failed = orders.filter((o) => o.payment?.status === 'FAILED');

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <Toolbar title="Payments & Razorpay" count={orders.length} />
        {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
        <div className="grid gap-3 px-4 pb-1 sm:grid-cols-2 xl:grid-cols-4">
          <div className="card p-5"><p className="flex items-center gap-2 text-sm text-ink-muted"><IndianRupee size={15} />Paid revenue</p><p className="mt-2 text-2xl font-bold text-leaf">{inr(counts.PAID?.total ?? 0)}</p><p className="text-xs text-ink-muted">{counts.PAID?.count ?? 0} orders</p></div>
          <div className="card p-5"><p className="flex items-center gap-2 text-sm text-ink-muted"><CreditCard size={15} />COD pending</p><p className="mt-2 text-2xl font-bold text-marigold-600">{inr(counts.COD_PENDING?.total ?? 0)}</p><p className="text-xs text-ink-muted">{counts.COD_PENDING?.count ?? 0} orders</p></div>
          <div className="card p-5"><p className="flex items-center gap-2 text-sm text-ink-muted"><XCircle size={15} />Failed payments</p><p className="mt-2 text-2xl font-bold text-alert">{counts.FAILED?.count ?? 0}</p><p className="text-xs text-ink-muted">{failed.length} pending retry</p></div>
          <div className="card p-5"><p className="flex items-center gap-2 text-sm text-ink-muted"><RotateCcw size={15} />Refunded</p><p className="mt-2 text-2xl font-bold text-blue-700">{inr(counts.REFUNDED?.total ?? 0)}</p><p className="text-xs text-ink-muted">{counts.REFUNDED?.count ?? 0} orders</p></div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.length === 0 ? <div className="col-span-full"><Empty message="Koi order nahi." /></div> : orders.map((order) => (
            <article key={order.orderNumber} className="rounded-xl border border-maroon-100 bg-white p-4 shadow-card transition hover:border-maroon-200">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{order.orderNumber}</p>
                  <p className="text-xs text-ink-muted">{new Date(order.placedAt).toLocaleDateString('en-IN')}</p>
                </div>
                <span className="shrink-0 text-lg font-bold text-ink">{inr(order.amounts?.totalMinor ?? 0)}</span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <p className="flex items-center justify-between gap-2"><span className="text-ink-muted">Method</span><span className="font-semibold text-ink">{order.payment?.method ?? '—'}</span></p>
                <p className="flex items-center justify-between gap-2"><span className="text-ink-muted">Status</span><Badge label={order.payment?.status ?? 'PENDING'} /></p>
                <p className="flex items-start justify-between gap-2"><span className="shrink-0 text-ink-muted">Razorpay</span><span className="min-w-0 break-all text-right font-mono text-[10px] text-ink-muted">{order.payment?.razorpayPaymentId || order.payment?.razorpayOrderId || '—'}</span></p>
                {order.payment?.failureReason ? (
                  <p className="flex items-start justify-between gap-2"><span className="shrink-0 text-ink-muted">Failure</span><span className="min-w-0 text-right text-alert">{order.payment.failureReason}</span></p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <Toolbar title="Razorpay account keys" count={razorpayDefs.length} />
        <SettingsForm definitions={razorpayDefs} />
      </section>
    </div>
  );
}