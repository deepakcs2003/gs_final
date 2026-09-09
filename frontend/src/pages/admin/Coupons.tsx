import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Empty, Field, Modal, Select, TextArea, TextInput, Toolbar, Toggle } from './shared';
import { Check, Pencil, Trash2 } from 'lucide-react';

interface Coupon {
  _id: string; code: string; description: string; type: 'PERCENT' | 'FIXED';
  value: number; minOrderInr: number; maxDiscountInr: number;
  categories: string[]; products: string[]; startsAt: string; expiresAt: string | null;
  usageLimit: number; usedCount: number; perUserLimit: number; isActive: boolean;
}

const emptyCoupon = (): Coupon => ({
  _id: '', code: '', description: '', type: 'PERCENT', value: 10, minOrderInr: 0, maxDiscountInr: 0,
  categories: [], products: [], startsAt: new Date().toISOString().slice(0, 10), expiresAt: null,
  usageLimit: 0, usedCount: 0, perUserLimit: 0, isActive: true,
});

export function CouponsModule() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [form, setForm] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: Coupon[] }>('/admin/coupons');
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Coupons load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const save = () => {
    if (!form) return;
    void setBusy(form._id || 'new');
    const { _id, usedCount, ...values } = form;
    const body = {
      ...values,
      value: Number(values.value),
      minOrderInr: Number(values.minOrderInr),
      maxDiscountInr: Number(values.maxDiscountInr),
      usageLimit: Number(values.usageLimit),
      perUserLimit: Number(values.perUserLimit),
      startsAt: values.startsAt ? new Date(values.startsAt) : undefined,
      expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
    };
    void api(`/admin/coupons${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body })
      .then(() => { setForm(null); void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string) => {
    if (!confirm('Coupon delete karein?')) return;
    void setBusy(id);
    void api(`/admin/coupons/${id}`, { method: 'DELETE' })
      .then(() => { setItems((items) => items.filter((i) => i._id !== id)); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'))
      .finally(() => setBusy(''));
  };

  const toggle = (coupon: Coupon) => {
    void setBusy(coupon._id);
    void api(`/admin/coupons/${coupon._id}`, { method: 'PATCH', body: { isActive: !coupon.isActive } })
      .then(() => { void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Coupons & discounts" count={items.length} onAdd={() => setForm(emptyCoupon())} addLabel="New coupon" />
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Koi coupon nahi. WELCOME10 jaisa coupon banao." /></div> :
          items.map((coupon) => {
            const expired = coupon.expiresAt ? new Date(coupon.expiresAt) < new Date() : false;
            return (
              <article className="rounded-xl border border-maroon-100 p-4" key={coupon._id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-lg font-bold tracking-wide text-maroon-700">{coupon.code}</p>
                    {coupon.description ? <p className="mt-0.5 text-xs text-ink-muted">{coupon.description}</p> : null}
                  </div>
                  {expired ? <Badge label="Expired" /> : coupon.isActive ? <Badge label="Active" /> : <Badge label="Disabled" />}
                </div>
                <p className="mt-3 text-2xl font-bold text-maroon-700">{coupon.type === 'PERCENT' ? `${coupon.value}% OFF` : `₹${coupon.value} OFF`}</p>
                {coupon.minOrderInr ? <p className="text-xs text-ink-muted">Min order: ₹{coupon.minOrderInr}</p> : null}
                {coupon.maxDiscountInr ? <p className="text-xs text-ink-muted">Max discount: ₹{coupon.maxDiscountInr}</p> : null}
                <p className="mt-1 text-xs text-ink-muted">Used {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}</p>
                {coupon.startsAt ? <p className="text-xs text-ink-muted">Starts: {new Date(coupon.startsAt).toLocaleDateString('en-IN')}</p> : null}
                {coupon.expiresAt ? <p className="text-xs text-ink-muted">Expires: {new Date(coupon.expiresAt).toLocaleDateString('en-IN')}</p> : null}
                <div className="mt-3 flex gap-2">
                  <BtnGhost className="flex-1 px-3" onClick={() => setForm({ ...coupon, startsAt: coupon.startsAt ? coupon.startsAt.slice(0, 10) : '', expiresAt: coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : '' })}><Pencil size={15} />Edit</BtnGhost>
                  <BtnGhost className="px-3" disabled={busy === coupon._id} onClick={() => toggle(coupon)}>{coupon.isActive ? 'Disable' : 'Enable'}</BtnGhost>
                  <BtnGhost className="px-3 text-alert" disabled={busy === coupon._id} onClick={() => remove(coupon._id)}><Trash2 size={15} /></BtnGhost>
                </div>
              </article>
            );
          })}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit coupon' : 'New coupon'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" hint="e.g. WELCOME10"><TextInput required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'PERCENT' | 'FIXED' })}>
              <option value="PERCENT">Percentage</option><option value="FIXED">Fixed amount</option>
            </Select></Field>
            <Field label={form.type === 'PERCENT' ? 'Percent off' : 'Fixed amount (INR)'}><TextInput type="number" min={0} required value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
            <Field label="Minimum order (INR)"><TextInput type="number" min={0} value={form.minOrderInr} onChange={(e) => setForm({ ...form, minOrderInr: Number(e.target.value) })} /></Field>
            <Field label="Maximum discount (INR)"><TextInput type="number" min={0} value={form.maxDiscountInr} onChange={(e) => setForm({ ...form, maxDiscountInr: Number(e.target.value) })} /></Field>
            <Field label="Start date"><TextInput type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label="Expiry date" hint="Empty = kabhi expire nahi hoga"><TextInput type="date" value={form.expiresAt ?? ''} onChange={(e) => setForm({ ...form, expiresAt: e.target.value || null })} /></Field>
            <Field label="Global usage limit (0 = unlimited)"><TextInput type="number" min={0} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: Number(e.target.value) })} /></Field>
            <Field label="Per-user limit (0 = unlimited)"><TextInput type="number" min={0} value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: Number(e.target.value) })} /></Field>
            <Field label="Description" className="sm:col-span-2"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /></div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}