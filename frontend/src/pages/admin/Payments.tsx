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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-maroon-50 text-ink-muted"><tr>
              <th className="p-4">Order</th><th className="p-4">Amount</th><th className="p-4">Method</th><th className="p-4">Status</th><th className="p-4">Razorpay</th><th className="p-4">Failure reason</th>
            </tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr className="border-t border-maroon-100" key={order.orderNumber}>
                  <td className="p-4 font-semibold">{order.orderNumber}<div className="text-xs font-normal text-ink-muted">{new Date(order.placedAt).toLocaleDateString('en-IN')}</div></td>
                  <td className="p-4">{inr(order.amounts?.totalMinor ?? 0)}</td>
                  <td className="p-4">{order.payment?.method ?? '—'}</td>
                  <td className="p-4"><Badge label={order.payment?.status ?? 'PENDING'} /></td>
                  <td className="p-4 font-mono text-xs text-ink-muted">{order.payment?.razorpayPaymentId || order.payment?.razorpayOrderId || '—'}</td>
                  <td className="p-4 text-xs text-alert">{order.payment?.failureReason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 ? <Empty message="Koi order nahi." /> : null}
        </div>
      </section>

      <section className="card overflow-hidden">
        <Toolbar title="Razorpay account keys" count={razorpayDefs.length} />
        <SettingsForm definitions={razorpayDefs} />
      </section>
    </div>
  );
}