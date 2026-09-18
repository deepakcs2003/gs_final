import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Empty, Field, Modal, TextInput, Toggle, Toolbar } from './shared';

interface AdminCollection {
  _id: string;
  slug: string;
  title: string;
  description: string;
  productIds: string[];
  isActive: boolean;
  order: number;
}

interface ProductPickerItem {
  _id: string;
  name: string;
  slug: string;
  type: string;
  images: Array<{ url: string }>;
}

const emptyCollection = (): AdminCollection => ({
  _id: '', slug: '', title: '', description: '', productIds: [], isActive: true, order: 0,
});

export function CollectionsModule() {
  const [items, setItems] = useState<AdminCollection[]>([]);
  const [products, setProducts] = useState<ProductPickerItem[]>([]);
  const [form, setForm] = useState<AdminCollection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [collections, productData] = await Promise.all([
        api<{ items: AdminCollection[] }>('/admin/product-collections'),
        api<{ items: ProductPickerItem[] }>('/admin/products?includeArchived=true'),
      ]);
      setItems(collections.items.sort((a, b) => a.order - b.order));
      setProducts(productData.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Collections load nahi hue.');
    }
  };

  useEffect(() => { void load(); }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => !q || `${product.name} ${product.slug}`.toLowerCase().includes(q));
  }, [products, search]);

  const save = () => {
    if (!form) return;
    const payload = {
      ...form,
      slug: form.slug.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      productIds: [...new Set(selectedIds)].slice(0, 10),
      order: Number(form.order),
    };
    setBusy(form._id || 'new');
    void api(`/admin/product-collections${form._id ? `/${form._id}` : ''}`, { method: form._id ? 'PATCH' : 'POST', body: payload })
      .then(() => {
        setForm(null);
        setSelectedIds([]);
        void load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string) => {
    if (!confirm('Collection delete karein?')) return;
    void api(`/admin/product-collections/${id}`, { method: 'DELETE' })
      .then(() => void load())
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'));
  };

  const copyLink = async (slug: string) => {
    const url = `${window.location.origin}/collection/${slug}`;
    await navigator.clipboard.writeText(url);
    setError('');
    alert('Collection link copied!');
  };

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId].slice(0, 10));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Collection links" count={items.length} onAdd={() => { setForm({ ...emptyCollection(), order: items.length }); setSelectedIds([]); }} addLabel="Add collection" />
      <p className="hint px-5 pb-2">Ek hi link mein 10 products ka curated bundle banayein. User us link se sabhi products ek saath dekh sakta hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      <div className="space-y-3 p-4">
        {items.length === 0 ? <Empty message="Abhi koi collection nahi banayi gayi." /> : items.map((item) => (
          <article key={item._id || item.slug} className={`flex items-center gap-3 rounded-xl border p-4 ${item.isActive ? 'border-maroon-100 bg-white' : 'border-dashed border-ink-light/40 bg-ink-light/5 opacity-70'}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink-light">#{item.order + 1}</span>
                <p className="truncate font-semibold">{item.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${item.isActive ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'}`}>{item.isActive ? 'Live' : 'Hidden'}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-muted">/collection/{item.slug} · {item.productIds.length} products</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <BtnGhost onClick={() => { setForm({ ...item }); setSelectedIds(item.productIds); }} className="min-h-9 px-2.5"><Pencil size={14} /></BtnGhost>
              <BtnGhost onClick={() => void copyLink(item.slug)} className="min-h-9 px-2.5"><Copy size={14} /></BtnGhost>
              <BtnGhost onClick={() => remove(item._id)} className="min-h-9 px-2.5 text-alert"><Trash2 size={14} /></BtnGhost>
            </div>
          </article>
        ))}
      </div>

      {form ? (
        <Modal open onClose={() => { setForm(null); setSelectedIds([]); }} title="Collection link" footer={
          <div className="flex justify-end">
            <BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>
              {busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}
            </BtnPrimary>
          </div>
        }>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Collection title"><TextInput required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="URL slug"><TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            </div>
            <Field label="Description"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display order"><TextInput type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
              <div className="flex items-end">
                <Toggle label="Show on storefront" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
              </div>
            </div>

            <div className="rounded-2xl border border-maroon-100 bg-maroon-50/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Select products ({selectedIds.length}/10)</p>
                <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product" className="max-w-[220px]" />
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {filteredProducts.length === 0 ? <p className="text-sm text-ink-muted">No products match.</p> : filteredProducts.map((product) => {
                  const active = selectedIds.includes(product._id);
                  return (
                    <button
                      key={product._id}
                      type="button"
                      onClick={() => toggleProduct(product._id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${active ? 'border-maroon-200 bg-white' : 'border-transparent bg-white/50 hover:border-maroon-100'}`}
                    >
                      <div className="h-12 w-12 overflow-hidden rounded-lg bg-ink-light/10">
                        {product.images?.[0]?.url ? <img src={product.images[0].url} alt={product.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                        <p className="text-xs text-ink-muted">{product.type} · /{product.slug}</p>
                      </div>
                      <span className={`grid h-6 w-6 place-items-center rounded-full border ${active ? 'border-maroon-600 bg-maroon-600 text-white' : 'border-ink-light bg-white text-transparent'}`}>
                        <Check size={12} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
