import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Empty, Field, ImagePicker, Modal, Select, TextInput, Toolbar, Toggle } from './shared';
import { Check, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { AdminProduct } from './Products';

interface Banner {
  _id: string; title: string; subtitle: string; image: string; ctaText: string; ctaLink: string;
  offerText: string; position: 'hero' | 'mid' | 'footer'; isActive: boolean;
  startsAt: string | null; expiresAt: string | null; order: number;
}

const emptyBanner = (): Banner => ({
  _id: '', title: '', subtitle: '', image: '', ctaText: 'Shop Now', ctaLink: '/', offerText: '',
  position: 'hero', isActive: true, startsAt: null, expiresAt: null, order: 0,
});

interface PopupProductRef { _id: string; designId?: string; name?: string; slug?: string; type?: string }
interface Popup {
  _id: string;
  productId: string | PopupProductRef;
  offerType: 'discount' | 'free';
  headline: string;
  limited: boolean;
  startsAt: string | null;
  endsAt: string | null;
  delaySeconds: number;
  isActive: boolean;
  order: number;
}

const emptyPopup = (): Popup => ({
  _id: '', productId: '', offerType: 'discount', headline: '', limited: false,
  startsAt: '', endsAt: '', delaySeconds: 30, isActive: true, order: 0,
});

type Tab = 'banners' | 'popups';

/** ISO → local `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type StatusInfo = { label: string; tone: 'leaf' | 'alert' | 'accent' | 'muted' };

function statusInfo(opts: { isActive: boolean; startsAt?: string | null; endsAt?: string | null; now?: number }): StatusInfo {
  const now = opts.now ?? Date.now();
  if (!opts.isActive) return { label: 'Inactive', tone: 'muted' };
  const start = opts.startsAt ? new Date(opts.startsAt).getTime() : 0;
  const end = opts.endsAt ? new Date(opts.endsAt).getTime() : 0;
  if (end && end < now) return { label: 'Expired', tone: 'alert' };
  if (start && start > now) return { label: 'Scheduled', tone: 'accent' };
  return { label: 'Active', tone: 'leaf' };
}

const STATUS_TONE: Record<StatusInfo['tone'], string> = {
  leaf: 'bg-leaf/10 text-leaf',
  alert: 'bg-alert/10 text-alert',
  accent: 'bg-marigold-100 text-ink',
  muted: 'bg-ink/10 text-ink-muted',
};

export function BannersModule() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('banners');

  const refreshStorefront = () => {
    // The storefront shares this query client — publishing a banner/popup
    // must be visible on Home immediately, not 5 minutes later.
    void qc.invalidateQueries({ queryKey: ['banners'] });
    void qc.invalidateQueries({ queryKey: ['offer-popup'] });
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex gap-1 border-b border-ink-light/20 p-2">
        {(['banners', 'popups'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              'min-h-9 rounded-lg px-4 text-sm font-bold transition',
              tab === key ? 'bg-maroon-700 text-white' : 'text-ink-muted hover:bg-maroon-50 hover:text-maroon-700',
            )}
          >
            {key === 'banners' ? 'Banners' : 'Offer popups'}
          </button>
        ))}
      </div>
      {tab === 'banners' ? (
        <BannersPanel onChanged={refreshStorefront} />
      ) : (
        <OfferPopupsPanel onChanged={refreshStorefront} />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Banners                                                                     */
/* -------------------------------------------------------------------------- */

function BannersPanel({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Banner[]>([]);
  const [form, setForm] = useState<Banner | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: Banner[] }>('/admin/banners');
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Banners load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const save = () => {
    if (!form) return;
    void setBusy(form._id || 'new');
    const { _id, ...values } = form;
    const body = {
      ...values,
      order: Number(values.order),
      startsAt: values.startsAt ? new Date(values.startsAt) : null,
      expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
    };
    void api(`/admin/banners${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body })
      .then(() => { setForm(null); void load(); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string) => {
    if (!confirm('Banner delete karein?')) return;
    void api(`/admin/banners/${id}`, { method: 'DELETE' })
      .then(() => { setItems((items) => items.filter((i) => i._id !== id)); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'));
  };

  const toggle = (banner: Banner) => {
    void setBusy(banner._id);
    void api(`/admin/banners/${banner._id}`, { method: 'PATCH', body: { isActive: !banner.isActive } })
      .then(() => { void load(); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <>
      <Toolbar title="Banners & offers" count={items.length} onAdd={() => setForm(emptyBanner())} addLabel="New banner" />
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Koi banner nahi. Flat 20% OFF wala banner banao." /></div> :
          items.map((banner) => (
            <article className="overflow-hidden rounded-xl border border-maroon-100" key={banner._id}>
              {banner.image ? <div className="h-32 overflow-hidden bg-maroon-50"><img src={banner.image} alt={banner.title} className="h-full w-full object-cover" /></div> : <div className="flex h-32 items-center justify-center bg-maroon-50 text-xs font-bold text-maroon-500">No image</div>}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{banner.title}</p>
                    {banner.offerText ? <p className="mt-0.5 text-sm font-bold text-alert">{banner.offerText}</p> : null}
                    {banner.subtitle ? <p className="text-xs text-ink-muted">{banner.subtitle}</p> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-maroon-50 px-2 py-0.5 text-[10px] font-bold text-maroon-700 uppercase">{banner.position}</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted"><strong className="text-maroon-700">{banner.ctaText}</strong> → {banner.ctaLink}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[statusInfo({ isActive: banner.isActive, startsAt: banner.startsAt, endsAt: banner.expiresAt }).tone])}>
                    {statusInfo({ isActive: banner.isActive, startsAt: banner.startsAt, endsAt: banner.expiresAt }).label}
                  </span>
                  <div className="flex gap-1.5">
                    <BtnGhost className="min-h-9 px-2.5" title="Edit" onClick={() => setForm({ ...banner, startsAt: toLocalInput(banner.startsAt), expiresAt: toLocalInput(banner.expiresAt) })}><Pencil size={14} /></BtnGhost>
                    <BtnGhost className="min-h-9 px-2.5" title={banner.isActive ? 'Inactive karein' : 'Active karein'} disabled={busy === banner._id} onClick={() => toggle(banner)}>{banner.isActive ? 'Off' : 'On'}</BtnGhost>
                    <BtnGhost className="min-h-9 px-2.5 text-alert" title="Delete" onClick={() => remove(banner._id)}><Trash2 size={14} /></BtnGhost>
                  </div>
                </div>
              </div>
            </article>
          ))}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit banner' : 'New banner'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Title"><TextInput required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Offer text" hint="e.g. Flat 20% OFF"><TextInput value={form.offerText} onChange={(e) => setForm({ ...form, offerText: e.target.value })} /></Field>
            <Field label="Subtitle"><TextInput value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></Field>
            <Field label="Position"><Select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value as Banner['position'] })}>
              <option value="hero">Hero (top)</option><option value="mid">Mid page</option><option value="footer">Footer</option>
            </Select></Field>
            <Field label="CTA button text"><TextInput value={form.ctaText} onChange={(e) => setForm({ ...form, ctaText: e.target.value })} /></Field>
            <Field label="CTA link"><TextInput value={form.ctaLink} onChange={(e) => setForm({ ...form, ctaLink: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Banner image" hint="Computer se upload karein ya URL paste karein. Open to pics / photo">
                <ImagePicker value={form.image ? [form.image] : []} max={1} onChange={(urls) => setForm({ ...form, image: urls[0] ?? '' })} />
              </Field>
            </div>
            <Field label="Display order"><TextInput type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
            <Field label="Start date/time"><TextInput type="datetime-local" value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value || null })} /></Field>
            <Field label="End date/time"><TextInput type="datetime-local" value={form.expiresAt ?? ''} onChange={(e) => setForm({ ...form, expiresAt: e.target.value || null })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Offer popups                                                                */
/* -------------------------------------------------------------------------- */

function OfferPopupsPanel({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Popup[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<Popup | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [popups, catalog] = await Promise.all([
        api<{ items: Popup[] }>('/admin/offer-popups'),
        api<{ items: AdminProduct[] }>('/admin/products?includeArchived=true'),
      ]);
      setItems(popups.items);
      setProducts(catalog.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Offer popups load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const selectedName = (productId: string | PopupProductRef) =>
    typeof productId === 'object' && productId?.name ? productId.name : products.find((p) => p._id === productId)?.name ?? 'Product';

  const save = () => {
    if (!form) return;
    if (!form.productId) { setError('Pehle product select karein.'); return; }
    void setBusy(form._id || 'new');
    const { _id, productId, endsAt, startsAt, ...values } = form;
    const body = {
      ...values,
      productId: typeof productId === 'string' ? productId : productId._id,
      order: Number(values.order),
      delaySeconds: Number(values.delaySeconds),
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: values.limited && endsAt ? new Date(endsAt) : null,
    };
    void api(`/admin/offer-popups${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body })
      .then(() => { setForm(null); void load(); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string) => {
    if (!confirm('Offer popup delete karein?')) return;
    void api(`/admin/offer-popups/${id}`, { method: 'DELETE' })
      .then(() => { setItems((items) => items.filter((i) => i._id !== id)); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'));
  };

  const toggle = (popup: Popup) => {
    void setBusy(popup._id);
    void api(`/admin/offer-popups/${popup._id}`, { method: 'PATCH', body: { isActive: !popup.isActive } })
      .then(() => { void load(); onChanged(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'))
      .finally(() => setBusy(''));
  };

  const openEdit = (popup: Popup) => {
    const productId = typeof popup.productId === 'string' ? popup.productId : popup.productId?._id ?? '';
    setForm({
      ...popup,
      productId,
      startsAt: toLocalInput(popup.startsAt),
      endsAt: toLocalInput(popup.endsAt),
    });
  };

  return (
    <>
      <Toolbar title="Offer popups" count={items.length} onAdd={() => setForm(emptyPopup())} addLabel="New popup" />
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Koi popup nahi. Pehla promotional popup banao." /></div> :
          items.map((popup) => (
            <article className="overflow-hidden rounded-xl border border-maroon-100 p-4" key={popup._id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{selectedName(popup.productId)}</p>
                  <p className="truncate text-xs text-ink-muted">{typeof popup.productId === 'object' ? popup.productId.designId : ''}</p>
                </div>
                <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', popup.offerType === 'free' ? 'bg-marigold-100 text-ink' : 'bg-maroon-50 text-maroon-700')}>
                  {popup.offerType === 'free' ? 'FREE' : 'Discount'}
                </span>
              </div>
              {popup.headline ? <p className="mt-1.5 text-sm font-bold text-maroon-700">{popup.headline}</p> : null}
              <p className="mt-1 text-xs text-ink-muted">
                {popup.limited && popup.endsAt ? `Limited • ${popup.endsAt.slice(0, 10)} • ` : ''}
                {popup.delaySeconds}s ke baad dikhega
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[statusInfo({ isActive: popup.isActive, startsAt: popup.startsAt, endsAt: popup.endsAt }).tone])}>
                  {statusInfo({ isActive: popup.isActive, startsAt: popup.startsAt, endsAt: popup.endsAt }).label}
                </span>
                <div className="flex gap-1.5">
                  <BtnGhost className="min-h-9 px-2.5" title="Edit" onClick={() => openEdit(popup)}><Pencil size={14} /></BtnGhost>
                  <BtnGhost className="min-h-9 px-2.5" title={popup.isActive ? 'Inactive karein' : 'Active karein'} disabled={busy === popup._id} onClick={() => toggle(popup)}>{popup.isActive ? 'Off' : 'On'}</BtnGhost>
                  <BtnGhost className="min-h-9 px-2.5 text-alert" title="Delete" onClick={() => remove(popup._id)}><Trash2 size={14} /></BtnGhost>
                </div>
              </div>
            </article>
          ))}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit offer popup' : 'New offer popup'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Product" hint="Popup mein dikhane wala exact product (READY_MADE / CUSTOMIZE)">
                <ProductPicker
                  products={products}
                  value={typeof form.productId === 'string' ? form.productId : form.productId?._id ?? ''}
                  onChange={(id) => setForm({ ...form, productId: id })}
                />
              </Field>
            </div>
            <Field label="Offer type"><Select value={form.offerType} onChange={(e) => setForm({ ...form, offerType: e.target.value as Popup['offerType'] })}>
              <option value="discount">Discount offer</option><option value="free">Free product</option>
            </Select></Field>
            <Field label="Headline" hint="Optional — e.g. 'Flat 20% OFF special'"><TextInput value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} /></Field>
            <Field label="Popup delay (seconds)" hint="Site khulne ke kitni der baad dikhe (min 5)"><TextInput type="number" min={5} max={600} value={form.delaySeconds} onChange={(e) => setForm({ ...form, delaySeconds: Number(e.target.value) })} /></Field>
            <Field label="Display order"><TextInput type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Limited time offer" checked={form.limited} onChange={(limited) => setForm({ ...form, limited })} /></div>
            <Field label="Start date/time" hint="Optional — ye time aane se pehle popup nahi dikhega"><TextInput type="datetime-local" value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value || null })} /></Field>
            {form.limited ? (
              <Field label="Offer end date/time"><TextInput type="datetime-local" value={form.endsAt ?? ''} onChange={(e) => setForm({ ...form, endsAt: e.target.value || null })} /></Field>
            ) : null}
            <div className="sm:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/** Searchable product dropdown (READY_MADE + CUSTOMIZE only — SHOWCASE ka popup
 *  nahi banta, kyunki uske liye page abhi coming-soon hai). */
function ProductPicker({ products, value, onChange }: { products: AdminProduct[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const eligible = products.filter((p) => p.type === 'READY_MADE' || p.type === 'CUSTOMIZE');
  const selected = eligible.find((p) => p._id === value) ?? null;
  const ql = q.trim().toLowerCase();
  const matches = eligible
    .filter((p) => !ql || `${p.designId} ${p.name} ${p.slug}`.toLowerCase().includes(ql))
    .slice(0, 8);

  return (
    <div className="relative mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="field flex min-h-[42px] w-full items-center gap-2 px-3 py-1.5 text-left">
        {selected ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{selected.name}</span>
            <span className="shrink-0 text-[10px] font-bold uppercase text-ink-muted">{selected.designId} · {selected.type}</span>
          </>
        ) : (
          <span className="flex-1 text-sm text-ink-light">Product select karein...</span>
        )}
        <ChevronDown size={15} className={clsx('shrink-0 text-ink-light transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-ink-light/30 bg-white p-1.5 shadow-sheet">
          <input autoFocus className="field mb-1.5 min-h-[38px] w-full px-3 py-1.5 text-sm" placeholder="Search design ID / naam..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
          {matches.length === 0 ? <p className="p-3 text-center text-xs text-ink-muted">Koi product nahi mila.</p> :
            matches.map((product) => (
              <button type="button" key={product._id} onClick={() => { onChange(product._id); setOpen(false); setQ(''); }}
                className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-maroon-50', value === product._id && 'bg-maroon-50')}>
                {product.images[0] ? <img src={product.images[0].url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-maroon-50 text-[9px] font-bold text-maroon-700">{product.designId}</span>}
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{product.name}</span>
                <span className="shrink-0 text-[9px] font-bold uppercase text-ink-muted">{product.designId} · {product.type}</span>
                {value === product._id ? <Check size={14} className="shrink-0 text-maroon-600" /> : null}
              </button>
            ))}
          <button type="button" onClick={() => setOpen(false)} className="w-full rounded-lg px-2.5 py-1.5 text-center text-[11px] font-bold text-ink-muted hover:bg-maroon-50">
            {matches.length === 0 ? 'Close' : `Close (${eligible.length} products)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}