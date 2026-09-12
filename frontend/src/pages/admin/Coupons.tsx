import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Empty, Field, inr, Modal, Select, TextArea, TextInput, Toolbar, Toggle } from './shared';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { cloudinarySrc } from '../../lib/image';
import type { AdminProduct } from './Products';

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
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [res, productRes] = await Promise.all([
        api<{ items: Coupon[] }>('/admin/coupons'),
        api<{ items: AdminProduct[] }>('/admin/products?includeArchived=true'),
      ]);
      setItems(res.items);
      setProducts(productRes.items);
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

  const scope = (form?.products?.length ?? 0) > 0 ? 'specific' : 'all';
  const setScope = (s: 'all' | 'specific') => {
    if (!form) return;
    setForm({ ...form, products: s === 'all' ? [] : (form.products ?? []) });
    if (s === 'specific') setPickerOpen(true);
  };
  const toggleProduct = (id: string) => {
    if (!form) return;
    const products = (form.products ?? []).includes(id)
      ? (form.products ?? []).filter((p) => p !== id)
      : [...(form.products ?? []), id];
    setForm({ ...form, products });
  };
  const filteredProducts = products.filter((p) => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.designId.toLowerCase().includes(q);
  });

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
                <p className="text-xs text-ink-muted">{coupon.products?.length ? `${coupon.products.length} product${coupon.products.length > 1 ? 's' : ''} par` : 'Sabhi products par'}</p>
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
            <Field label="Minimum order (INR)" hint="0 = koi bhi amount par chalega. Example: 999"><TextInput type="number" min={0} value={form.minOrderInr} onChange={(e) => setForm({ ...form, minOrderInr: Number(e.target.value) })} /></Field>
            <Field label="Maximum discount (INR)"><TextInput type="number" min={0} value={form.maxDiscountInr} onChange={(e) => setForm({ ...form, maxDiscountInr: Number(e.target.value) })} /></Field>
            <Field label="Apply coupon to" className="sm:col-span-2">
              <Select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'specific')}>
                <option value="all">Sabhi products</option>
                <option value="specific">Sirf kuch specific products</option>
              </Select>
              <p className="mt-1 text-xs text-ink-muted">Threshold (₹999 ke upar jaise) upar min order se set karein.</p>
            </Field>
            {scope === 'specific' ? (
              <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-maroon-700">Products is coupon par</h4>
                  <BtnGhost className="px-3" onClick={() => setPickerOpen(true)}>
                    <Pencil size={14} />Products select karein{form.products.length ? ` (${form.products.length})` : ''}
                  </BtnGhost>
                </div>
                {form.products.length === 0 ? (
                  <p className="mt-2 text-xs font-semibold text-ink-muted">Abhi koi product select nahi hua.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.products.map((id) => {
                      const p = products.find((product) => product._id === id);
                      return p
                        ? <span key={id} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-maroon-700">{p.designId} · {p.name}</span>
                        : null;
                    })}
                  </div>
                )}
              </div>
            ) : null}
            <Field label="Start date"><TextInput type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label="Expiry date" hint="Empty = kabhi expire nahi hoga"><TextInput type="date" value={form.expiresAt ?? ''} onChange={(e) => setForm({ ...form, expiresAt: e.target.value || null })} /></Field>
            <Field label="Global usage limit (0 = unlimited)"><TextInput type="number" min={0} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: Number(e.target.value) })} /></Field>
            <Field label="Per-user limit (0 = unlimited)"><TextInput type="number" min={0} value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: Number(e.target.value) })} /></Field>
            <Field label="Description" className="sm:col-span-2"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /></div>
          </form>
        </Modal>
      ) : null}

      {pickerOpen && form ? (
        <Modal open onClose={() => setPickerOpen(false)} title="Products select karein"
          subtitle="Jin products par yeh coupon chalega unhe select karein"
          footer={<div className="flex items-center justify-end gap-2">
            <BtnGhost onClick={() => setPickerOpen(false)}>Cancel</BtnGhost>
            <BtnPrimary onClick={() => setPickerOpen(false)}><Check size={15} />Done ({form.products.length})</BtnPrimary>
          </div>}>
          <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Design ID ya naam se search karein..."
            className="field min-h-[40px] px-3 py-2 text-sm" />
          <p className="mt-2 text-xs text-ink-muted">{form.products.length} selected — row par tap karke select/deselect karein.</p>
          <div className="mt-2 max-h-[42vh] space-y-2 overflow-auto pr-1">
            {filteredProducts.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Koi product nahi mila.</p>
            ) : filteredProducts.map((p) => {
              const selected = (form.products ?? []).includes(p._id);
              return (
                <button type="button" key={p._id} onClick={() => toggleProduct(p._id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${selected ? 'border-leaf bg-leaf/10' : 'border-maroon-100 bg-white hover:border-maroon-300'}`}>
                  {p.images?.[0]?.url ? (
                    <img src={cloudinarySrc(p.images[0].url, 96)} alt={p.name} loading="lazy" className="h-12 w-12 shrink-0 rounded-lg border border-maroon-100 object-cover" />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-ink-light/40 bg-maroon-50/40 text-[10px] font-semibold text-ink-light">No img</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold tracking-wider text-maroon-600">{p.designId}</p>
                    <h4 className="truncate text-sm font-semibold">{p.name}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold text-maroon-700">{inr(p.sellingPriceInr * 100)}</span>
                      {p.mrpInr > 0 && p.mrpInr > p.sellingPriceInr ? <span className="text-[11px] text-ink-light line-through">{inr(p.mrpInr * 100)}</span> : null}
                      <Badge label={p.type.replace('_', ' ')} />
                      {p.isActive ? <Badge label="Live" /> : <Badge label="Archived" />}
                    </div>
                  </div>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${selected ? 'border-leaf bg-leaf text-white' : 'border-ink-light/40 bg-white'}`}>
                    {selected ? <Check size={14} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}