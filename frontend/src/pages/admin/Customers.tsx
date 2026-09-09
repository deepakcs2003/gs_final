import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnOutline, Empty, Modal, Toolbar, inr } from './shared';
import { Eye, X, Ban, Check } from 'lucide-react';

interface Customer {
  _id: string; name: string; mobile: string; email: string; isBlocked: boolean;
  createdAt: string; lastLoginAt: string | null;
  adminRoles: string[];
  stats?: { orderCount: number; totalSpentMinor: number; lastOrderAt: string | null };
}
interface CustomerOrder {
  orderNumber: string; status: string; placedAt: string; amounts: { totalMinor: number };
  items: Array<{ designId: string; name: string; quantity: number }>;
}

export function CustomersModule() {
  const [items, setItems] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<CustomerOrder[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: Customer[] }>(`/admin/customers?q=${encodeURIComponent(query)}`);
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Customers load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => items.filter((c) =>
    `${c.name} ${c.mobile} ${c.email ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  ), [items, query]);

  const openDetail = async (customer: Customer) => {
    setSelected(customer);
    const res = await api<{ orders: CustomerOrder[] }>(`/admin/customers/${customer._id}`);
    setSelectedOrders(res.orders);
  };

  const toggleBlock = (customer: Customer) => {
    void setBusy(customer._id);
    void api(`/admin/customers/${customer._id}`, { method: 'PATCH', body: { isBlocked: !customer.isBlocked } })
      .then(() => { setItems((items) => items.map((c) => c._id === customer._id ? { ...c, isBlocked: !customer.isBlocked } : c)); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Action nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Customers" count={filtered.length} searchPlaceholder="Name, mobile, email..." query={query} onQuery={setQuery} />
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 ? <div className="col-span-full"><Empty message="Koi customer nahi mila." /></div> :
          filtered.map((customer) => {
            const stats = customer.stats ?? { orderCount: 0, totalSpentMinor: 0, lastOrderAt: null };
            return (
              <article className="rounded-xl border border-maroon-100 p-4" key={customer._id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate font-semibold">{customer.name || 'Guest customer'}</h4>
                      {customer.isBlocked ? <Badge label="Blocked" /> : null}
                    </div>
                    <p className="text-sm text-ink-muted">{customer.mobile}</p>
                    {customer.email ? <p className="truncate text-xs text-ink-muted">{customer.email}</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span><strong>{stats.orderCount}</strong> orders</span>
                  <span><strong>{inr(stats.totalSpentMinor)}</strong> spent</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <BtnOutline className="flex-1 px-3" onClick={() => void openDetail(customer)}><Eye size={15} />View</BtnOutline>
                  {customer.isBlocked
                    ? <BtnGhost className="px-3 text-leaf" disabled={busy === customer._id} onClick={() => toggleBlock(customer)}><Check size={15} />Unblock</BtnGhost>
                    : <BtnGhost className="px-3 text-alert" disabled={busy === customer._id} onClick={() => toggleBlock(customer)}><Ban size={15} />Block</BtnGhost>}
                </div>
              </article>
            );
          })}
      </div>

      {selected ? (
        <Modal open onClose={() => setSelected(null)} title={selected.name || 'Customer'} subtitle={`${selected.mobile} ${selected.email ? `· ${selected.email}` : ''}`} maxWidth="sm:max-w-2xl"
          footer={<div className="flex justify-end"><BtnGhost onClick={() => setSelected(null)}><X size={15} />Close</BtnGhost></div>}>
          <div className="space-y-4">
            <section className="rounded-xl border border-maroon-100 p-4">
              <h4 className="text-sm font-bold text-maroon-700">Order history</h4>
              <div className="mt-3 space-y-2">
                {selectedOrders.length === 0 ? <p className="text-sm text-ink-muted">Koi order nahi.</p> :
                  selectedOrders.map((order) => (
                    <div className="flex items-center justify-between rounded-lg border border-maroon-50 p-3 text-sm" key={order.orderNumber}>
                      <div><strong>{order.orderNumber}</strong>
                        <div className="text-xs text-ink-muted">{new Date(order.placedAt).toLocaleDateString('en-IN')} · {order.items.map((i) => `${i.designId}×${i.quantity}`).join(', ')}</div>
                      </div>
                      <div className="text-right"><span className="font-semibold">{inr(order.amounts.totalMinor)}</span><div className="mt-1"><Badge label={order.status} /></div></div>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}