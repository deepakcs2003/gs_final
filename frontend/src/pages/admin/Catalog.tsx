import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Checkbox, ColorPaletteSelect, Empty, Field, ImagePicker, Modal, PaletteColor, Select, StringListEditor, TextArea, TextInput, Toolbar, Toggle, inr } from './shared';
import { Copy, Pencil, Trash2, Check, X, Sparkles } from 'lucide-react';

interface Category { _id: string; name: string; nameHi: string; slug: string; types: string[]; image: string; order: number; isActive: boolean; productCount?: number }
interface Fabric { _id: string; name: string; slug: string; material: string; colorName: string; colorSlug: string; colorHex: string; colors: Array<{ name: string; hex: string }>; embroidery: string[]; priceInr: number; image: string; inStock: boolean; stockMeters: number; isActive: boolean; order: number }
interface Lace { _id: string; name: string; slug: string; colorName: string; colorHex: string; colors: Array<{ name: string; hex: string }>; priceInr: number; image: string; inStock: boolean; isActive: boolean; order: number }
interface Latkan { _id: string; name: string; slug: string; colorName: string; colorHex: string; colors: Array<{ name: string; hex: string }>; priceInr: number; image: string; inStock: boolean; isActive: boolean; order: number }
interface Color { _id: string; name: string; slug: string; hex: string; image: string; isActive: boolean; order: number }
interface SizeItem { _id: string; label: string; value: number; priceModifierInr: number; isActive: boolean; order: number }

const emptyCategory = (): Category => ({ _id: '', name: '', nameHi: '', slug: '', types: ['READY_MADE', 'CUSTOMIZE', 'SHOWCASE'], image: '', order: 0, isActive: true });
const emptyFabric = (): Fabric => ({ _id: '', name: '', slug: '', material: 'Silk', colorName: '', colorSlug: '', colorHex: '#cccccc', colors: [], embroidery: [], priceInr: 0, image: '', inStock: true, stockMeters: 0, isActive: true, order: 0 });
const emptyLace = (): Lace => ({ _id: '', name: '', slug: '', colorName: '', colorHex: '#cccccc', colors: [], priceInr: 0, image: '', inStock: true, isActive: true, order: 0 });
const emptyLatkan = (): Latkan => ({ _id: '', name: '', slug: '', colorName: '', colorHex: '#cccccc', colors: [], priceInr: 0, image: '', inStock: true, isActive: true, order: 0 });
const emptyColor = (): Color => ({ _id: '', name: '', slug: '', hex: '#cccccc', image: '', isActive: true, order: 0 });
const emptySize = (): SizeItem => ({ _id: '', label: '36', value: 36, priceModifierInr: 0, isActive: true, order: 0 });

type Kind = 'categories' | 'fabrics' | 'laces' | 'latkans' | 'colors' | 'sizes';

export function CatalogModule() {
  const [kind, setKind] = useState<Kind>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [laces, setLaces] = useState<Lace[]>([]);
  const [latkans, setLatkans] = useState<Latkan[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [sizes, setSizes] = useState<SizeItem[]>([]);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [cat, fab, lac, lat, col, sz] = await Promise.all([
        api<{ items: Category[] }>('/admin/categories'),
        api<{ items: Fabric[] }>('/admin/fabrics'),
        api<{ items: Lace[] }>('/admin/laces'),
        api<{ items: Latkan[] }>('/admin/latkans'),
        api<{ items: Color[] }>('/admin/colors'),
        api<{ items: SizeItem[] }>('/admin/sizes'),
      ]);
      setCategories(cat.items); setFabrics(fab.items); setLaces(lac.items); setLatkans(lat.items); setColors(col.items); setSizes(sz.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Catalog load nahi hua.'); }
  };
  useEffect(() => { void load(); }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try { await action(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Action complete nahi hua.'); } finally { setBusy(''); }
  };

  const save = () => {
    if (!form) return;
    const id = form._id as string;
    void run(id || 'new', async () => {
      // Docs come back from GET with server-managed fields; the backend's
      // strict schemas reject them, so strip them here.
      const { _id, createdAt, updatedAt, __v, productCount, ...values } = form;
      const path = kind === 'categories' ? 'categories' : kind === 'fabrics' ? 'fabrics' : kind === 'laces' ? 'laces' : kind === 'latkans' ? 'latkans' : kind === 'colors' ? 'colors' : 'sizes';
      if (id) {
        const res = await api<{ [k: string]: unknown }>(`/admin/${path}/${id}`, { method: 'PATCH', body: values });
        const updated = res[path === 'categories' ? 'category' : path === 'fabrics' ? 'fabric' : path === 'laces' ? 'lace' : path === 'latkans' ? 'latkan' : path === 'colors' ? 'color' : 'size'] as Record<string, unknown>;
        applySet(updated as never);
      } else {
        const res = await api<{ [k: string]: unknown }>(`/admin/${path}`, { method: 'POST', body: values });
        const created = res[path === 'categories' ? 'category' : path === 'fabrics' ? 'fabric' : path === 'laces' ? 'lace' : path === 'latkans' ? 'latkan' : path === 'colors' ? 'color' : 'size'] as Record<string, unknown>;
        applySet(created as never);
      }
      setForm(null);
    });
  };

  const applySet = (item: never) => {
    if (kind === 'categories') setCategories((items) => upsertItem(items, item));
    else if (kind === 'fabrics') setFabrics((items) => upsertItem(items, item));
    else if (kind === 'laces') setLaces((items) => upsertItem(items, item));
    else if (kind === 'latkans') setLatkans((items) => upsertItem(items, item));
    else if (kind === 'colors') setColors((items) => upsertItem(items, item));
    else setSizes((items) => upsertItem(items, item as unknown as SizeItem));
  };

  const remove = (id: string, label: string) => {
    const path = kind === 'categories' ? 'categories' : kind === 'fabrics' ? 'fabrics' : kind === 'laces' ? 'laces' : kind === 'latkans' ? 'latkans' : kind === 'colors' ? 'colors' : 'sizes';
    void run(`del-${id}`, async () => {
      await api(`/admin/${path}/${id}`, { method: 'DELETE' });
      if (kind === 'categories') setCategories((items) => items.filter((i) => i._id !== id));
      else if (kind === 'fabrics') setFabrics((items) => items.filter((i) => i._id !== id));
      else if (kind === 'laces') setLaces((items) => items.filter((i) => i._id !== id));
      else if (kind === 'latkans') setLatkans((items) => items.filter((i) => i._id !== id));
      else if (kind === 'colors') setColors((items) => items.filter((i) => i._id !== id));
      else setSizes((items) => items.filter((i) => i._id !== id));
      void load();
    });
    // eslint-disable-next-line no-console
    void label;
  };

  const duplicate = (id: string) => {
    const path = kind === 'categories' ? 'categories' : kind === 'fabrics' ? 'fabrics' : kind === 'laces' ? 'laces' : kind === 'latkans' ? 'latkans' : kind === 'colors' ? 'colors' : 'sizes';
    void run(`dup-${id}`, async () => {
      await api(`/admin/${path}/${id}/duplicate`, { method: 'POST' });
      void load();
    });
  };

  const toggle = (id: string, isActive: boolean) => {
    const path = kind === 'categories' ? 'categories' : kind === 'fabrics' ? 'fabrics' : kind === 'laces' ? 'laces' : kind === 'latkans' ? 'latkans' : kind === 'colors' ? 'colors' : 'sizes';
    void run(`tog-${id}`, async () => {
      await api(`/admin/${path}/${id}`, { method: 'PATCH', body: { isActive: !isActive } });
      void load();
    });
  };

  const openNew = () => {
    setForm((kind === 'categories' ? emptyCategory() : kind === 'fabrics' ? emptyFabric() : kind === 'laces' ? emptyLace() : kind === 'latkans' ? emptyLatkan() : kind === 'colors' ? emptyColor() : emptySize()) as unknown as Record<string, unknown>);
  };

  const counts: Record<Kind, number> = { categories: categories.length, fabrics: fabrics.length, laces: laces.length, latkans: latkans.length, colors: colors.length, sizes: sizes.length };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Catalog management" count={counts[kind]} onAdd={openNew} addLabel="Add"
        onQuery={undefined} />
      <div className="flex gap-2 overflow-x-auto px-5 py-3">
        {(['categories', 'fabrics', 'laces', 'latkans', 'colors', 'sizes'] as Kind[]).map((k) => (
          <button key={k} onClick={() => { setKind(k); setForm(null); }}
            className={`chip whitespace-nowrap ${kind === k ? 'chip-active' : ''}`}>{k} ({counts[k]})</button>
        ))}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      {kind === 'categories' ? (
        <CategoryList items={categories} onEdit={(c) => setForm(c as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'category')} onDuplicate={duplicate} busy={busy} />
      ) : null}
      {kind === 'fabrics' ? (
        <FabricList items={fabrics} onEdit={(f) => setForm(f as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'fabric')} onDuplicate={duplicate} busy={busy} />
      ) : null}
      {kind === 'laces' ? (
        <LaceList items={laces} onEdit={(l) => setForm(l as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'lace')} onDuplicate={duplicate} busy={busy} />
      ) : null}
      {kind === 'latkans' ? (
        <LatkanList items={latkans} onEdit={(l) => setForm(l as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'latkan')} onDuplicate={duplicate} busy={busy} />
      ) : null}
      {kind === 'colors' ? (
        <ColorList items={colors} onEdit={(c) => setForm(c as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'color')} busy={busy} />
      ) : null}
      {kind === 'sizes' ? (
        <SizeList items={sizes} onEdit={(s) => setForm(s as unknown as Record<string, unknown>)} onToggle={toggle} onDelete={(id) => remove(id, 'size')} busy={busy} />
      ) : null}

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? `Edit ${kind.slice(0, -1)}` : `New ${kind.slice(0, -1)}`}
          footer={<div className="flex justify-end gap-2"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={16} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            {kind === 'categories' ? <CategoryForm form={form} setForm={setForm} /> : null}
            {kind === 'fabrics' ? <FabricForm palette={colors.map((c) => ({ name: c.name, hex: c.hex }))} form={form} setForm={setForm} /> : null}
            {kind === 'laces' ? <LaceForm palette={colors.map((c) => ({ name: c.name, hex: c.hex }))} form={form} setForm={setForm} /> : null}
            {kind === 'latkans' ? <LatkanForm palette={colors.map((c) => ({ name: c.name, hex: c.hex }))} form={form} setForm={setForm} /> : null}
            {kind === 'colors' ? <ColorForm form={form} setForm={setForm} /> : null}
            {kind === 'sizes' ? <SizeForm form={form} setForm={setForm} /> : null}
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function upsertItem<T extends { _id: string }>(items: T[], item: T): T[] {
  const found = items.some((i) => i._id === item._id);
  return found ? items.map((i) => (i._id === item._id ? item : i)) : [item, ...items];
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                        */
/* -------------------------------------------------------------------------- */

function CategoryList({ items, onEdit, onToggle, onDelete, onDuplicate, busy }: { items: Category[]; onEdit: (c: Category) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; busy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Category</th><th className="p-4">Slug</th><th className="p-4">Types</th><th className="p-4">Products</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{items.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={6}>Koi category nahi hai.</td></tr> : items.map((item) => (
          <tr className="border-t border-maroon-100" key={item._id}>
            <td className="p-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-maroon-50">
              {item.image ? <img src={item.image} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="text-xs font-bold text-maroon-700">CAT</span>}
            </div><div><strong>{item.name}</strong>{item.nameHi ? <div className="text-xs text-ink-muted">{item.nameHi}</div> : null}</div></div></td>
            <td className="p-4 text-ink-muted">{item.slug}</td>
            <td className="p-4"><div className="flex flex-wrap gap-1">{item.types.map((t) => <span key={t} className="rounded-full bg-maroon-50 px-2 py-0.5 text-[10px] font-bold">{t.replace('_', ' ')}</span>)}</div></td>
            <td className="p-4 font-semibold">{item.productCount ?? 0}</td>
            <td className="p-4"><Badge label={item.isActive ? 'Live' : 'Off'} /></td>
            <td className="p-4"><div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `dup-${item._id}`} onClick={() => onDuplicate(item._id)}><Copy size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FabricList({ items, onEdit, onToggle, onDelete, onDuplicate, busy }: { items: Fabric[]; onEdit: (f: Fabric) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; busy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Fabric</th><th className="p-4">Material</th><th className="p-4">Color</th><th className="p-4">Price</th><th className="p-4">Stock</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{items.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={7}>Koi fabric nahi hai.</td></tr> : items.map((item) => (
          <tr className="border-t border-maroon-100" key={item._id}>
            <td className="p-4 font-semibold">{item.name}</td>
            <td className="p-4">{item.material}</td>
            <td className="p-4"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-ink-light/40" style={{ backgroundColor: item.colorHex }} />{item.colorName}</span></td>
            <td className="p-4 font-semibold">{inr(item.priceInr * 100)}</td>
            <td className="p-4">{item.inStock ? <span className="font-semibold text-leaf">{item.stockMeters} m</span> : <span className="font-semibold text-alert">Out of stock</span>}</td>
            <td className="p-4"><Badge label={item.isActive ? 'Live' : 'Off'} /></td>
            <td className="p-4"><div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `dup-${item._id}`} onClick={() => onDuplicate(item._id)}><Copy size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function LaceList({ items, onEdit, onToggle, onDelete, onDuplicate, busy }: { items: Lace[]; onEdit: (l: Lace) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; busy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Lace</th><th className="p-4">Color</th><th className="p-4">Price</th><th className="p-4">Stock</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{items.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={6}>Koi lace nahi hai.</td></tr> : items.map((item) => (
          <tr className="border-t border-maroon-100" key={item._id}>
            <td className="p-4 font-semibold">{item.name}</td>
            <td className="p-4"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-ink-light/40" style={{ backgroundColor: item.colorHex }} />{item.colorName || '—'}</span></td>
            <td className="p-4 font-semibold">{inr(item.priceInr * 100)}</td>
            <td className="p-4">{item.inStock ? <span className="text-leaf">In stock</span> : <span className="text-alert">Out of stock</span>}</td>
            <td className="p-4"><Badge label={item.isActive ? 'Live' : 'Off'} /></td>
            <td className="p-4"><div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `dup-${item._id}`} onClick={() => onDuplicate(item._id)}><Copy size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function LatkanList({ items, onEdit, onToggle, onDelete, onDuplicate, busy }: { items: Latkan[]; onEdit: (l: Latkan) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; busy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Latkan</th><th className="p-4">Color</th><th className="p-4">Price</th><th className="p-4">Stock</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{items.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={6}>Koi latkan nahi hai.</td></tr> : items.map((item) => (
          <tr className="border-t border-maroon-100" key={item._id}>
            <td className="p-4 font-semibold">{item.name}</td>
            <td className="p-4"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-ink-light/40" style={{ backgroundColor: item.colorHex }} />{item.colorName || '—'}</span></td>
            <td className="p-4 font-semibold">{inr(item.priceInr * 100)}</td>
            <td className="p-4">{item.inStock ? <span className="text-leaf">In stock</span> : <span className="text-alert">Out of stock</span>}</td>
            <td className="p-4"><Badge label={item.isActive ? 'Live' : 'Off'} /></td>
            <td className="p-4"><div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `dup-${item._id}`} onClick={() => onDuplicate(item._id)}><Copy size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ColorList({ items, onEdit, onToggle, onDelete, busy }: { items: Color[]; onEdit: (c: Color) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; busy: string }) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.length === 0 ? <div className="col-span-full"><Empty message="Koi color nahi hai. Apne colors create karein." /></div> : items.map((item) => (
        <article className="rounded-xl border border-maroon-100 p-4" key={item._id}>
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-full border border-ink-light/40" style={{ backgroundColor: item.hex }} />
            <div className="min-w-0"><p className="font-semibold">{item.name}</p><p className="text-xs text-ink-muted uppercase">{item.hex}</p></div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Badge label={item.isActive ? 'Active' : 'Inactive'} />
            <div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SizeList({ items, onEdit, onToggle, onDelete, busy }: { items: SizeItem[]; onEdit: (s: SizeItem) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; busy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-maroon-50 text-ink-muted"><tr><th className="p-4">Size</th><th className="p-4">Value</th><th className="p-4">Price modifier</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{items.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={5}>Koi size nahi hai.</td></tr> : items.map((item) => (
          <tr className="border-t border-maroon-100" key={item._id}>
            <td className="p-4 font-semibold">{item.label}</td>
            <td className="p-4">{item.value}</td>
            <td className="p-4">{item.priceModifierInr ? inr(item.priceModifierInr * 100) : '—'}</td>
            <td className="p-4"><Badge label={item.isActive ? 'Active' : 'Inactive'} /></td>
            <td className="p-4"><div className="flex gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => onEdit(item)}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5" disabled={busy === `tog-${item._id}`} onClick={() => onToggle(item._id, item.isActive)}>{item.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === `del-${item._id}`} onClick={() => onDelete(item._id)}><Trash2 size={14} /></BtnGhost>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                        */
/* -------------------------------------------------------------------------- */

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <Field label={label} hint={hint} className="sm:col-span-2">{children}</Field>;
}

function CategoryForm({ form, setForm }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  return (<>
    <FormField label="Category name"><TextInput required value={form.name as string} onChange={(e) => set({ name: e.target.value, slug: (form.slug as string) || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></FormField>
    <Field label="Hindi name"><TextInput value={form.nameHi as string} onChange={(e) => set({ nameHi: e.target.value })} /></Field>
    <Field label="Slug"><TextInput value={form.slug as string} onChange={(e) => set({ slug: e.target.value })} /></Field>
    <FormField label="Types" hint="Is category ke products kis section mein dikhenge">
      <div className="mt-1 space-y-2">
        {['READY_MADE', 'CUSTOMIZE', 'SHOWCASE'].map((t) => (
          <Checkbox key={t} label={t.replace('_', ' ')} checked={(form.types as string[]).includes(t)} onChange={(checked) => set({ types: checked ? [...(form.types as string[]), t] : (form.types as string[]).filter((x: string) => x !== t) })} />
        ))}
      </div>
    </FormField>
    <Field label="Image URL"><TextInput value={form.image as string} onChange={(e) => set({ image: e.target.value })} /></Field>
    <Field label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></Field>
    <FormField label="SEO title"><TextInput value={form.seoTitle as string} onChange={(e) => set({ seoTitle: e.target.value })} /></FormField>
    <FormField label="SEO description"><TextArea value={form.seoDescription as string} onChange={(e) => set({ seoDescription: e.target.value })} /></FormField>
  </>);
}

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (value === '#cccccc') return true;
  if (typeof value === 'number') return value === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const slugifyField = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Fill only empty fields — or fields we ourselves last generated — never manual edits. */
function mergeSuggestion(form: Record<string, unknown>, lastGen: Record<string, unknown>, s: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    const v = s[f];
    if (v === null || v === undefined) continue;
    if (isEmptyValue(form[f]) || JSON.stringify(lastGen[f]) === JSON.stringify(form[f])) patch[f] = v;
  }
  return patch;
}

function QwenPicker({ endpoint, imageUrl, apply, hint }: { endpoint: string; imageUrl: string; apply: (s: Record<string, unknown>, lastGen: Record<string, unknown>) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastGen, setLastGen] = useState<Record<string, unknown>>({});

  const run = async () => {
    if (!imageUrl) { setMsg({ ok: false, text: 'Pehle image upload ya URL paste karein.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await api<{ suggestion: Record<string, unknown> }>(endpoint, { method: 'POST', body: { imageUrl } });
      apply(res.suggestion, lastGen);
      setLastGen(res.suggestion);
      setMsg({ ok: true, text: 'Details ready — Save se pehle review karein.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Qwen se generate nahi ho paya.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-maroon-200 bg-maroon-50/40 p-3">
      <BtnPrimary type="button" onClick={() => void run()} disabled={busy || !imageUrl}>
        <Sparkles size={16} />{busy ? 'Analyzing image...' : 'Generate with Qwen'}
      </BtnPrimary>
      {msg ? <span className={`text-xs font-semibold ${msg.ok ? 'text-leaf' : 'text-alert'}`}>{msg.text}</span> : null}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}

function FabricForm({ form, setForm, palette }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void; palette: PaletteColor[] }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  const syncSlug = (name: string) => ({ name, slug: (form.slug as string) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  const pickColors = (colors: PaletteColor[]) => {
    // Storefront fabric card still shows ONE primary colour — auto-sync it from
    // the first picked palette colour only when it hasn't been typed manually.
    const primary =
      !isEmptyValue(form.colorName) || colors.length === 0
        ? {}
        : { colorName: colors[0].name, colorSlug: colors[0].name.toLowerCase().replace(/\s+/g, '-'), colorHex: colors[0].hex };
    set({ colors, ...primary });
  };
  return (<>
    <Field label="Fabric name"><TextInput required value={form.name as string} onChange={(e) => set(syncSlug(e.target.value))} /></Field>
    <Field label="Material type"><Select value={form.material as string} onChange={(e) => set({ material: e.target.value })}>
      {['Silk', 'Georgette', 'Cotton', 'Satin', 'Chiffon', 'Velvet', 'Net', 'Organza', 'Crepe', 'Kanjivaram', 'Banarasi', 'Other'].map((m) => <option key={m}>{m}</option>)}
    </Select></Field>
    <FormField label="Colors" hint="Admin → Catalog → Colour palette se fabric ke saare available colours select karein. Pehla colour storefront par primary dikhata hai.">
      <ColorPaletteSelect palette={palette} value={(form.colors as PaletteColor[]) ?? []} onChange={pickColors} />
    </FormField>
    <FormField label="Color name"><TextInput required value={form.colorName as string} onChange={(e) => set({ colorName: e.target.value, colorSlug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} /></FormField>
    <Field label="Color code">
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.colorHex as string) ? form.colorHex as string : '#cccccc'} onChange={(e) => set({ colorHex: e.target.value })} className="h-10 w-14 rounded border border-ink-light/30" />
        <TextInput className="flex-1" value={form.colorHex as string} onChange={(e) => set({ colorHex: e.target.value })} />
      </div>
    </Field>
    <Field label="Price (INR)"><TextInput type="number" min={0} required value={form.priceInr as number} onChange={(e) => set({ priceInr: Number(e.target.value) })} /></Field>
    <Field label="Stock (metres)"><TextInput type="number" min={0} value={form.stockMeters as number} onChange={(e) => set({ stockMeters: Number(e.target.value), inStock: Number(e.target.value) > 0 || Boolean(form.inStock) })} /></Field>
    <Field label="Image">
      <ImagePicker value={form.image ? [form.image as string] : []} onChange={(urls) => set({ image: urls[0] ?? '' })} max={1} />
      <QwenPicker endpoint="/admin/fabrics/generate-with-qwen" imageUrl={form.image as string}
        apply={(s, lastGen) => {
          const patch = mergeSuggestion(form, lastGen, s, ['name', 'material', 'colorName', 'colorHex', 'priceInr', 'embroidery']);
          if (patch.colorName && isEmptyValue(form.colorSlug)) patch.colorSlug = (patch.colorName as string).toLowerCase().replace(/\s+/g, '-');
          if (patch.name && isEmptyValue(form.slug)) patch.slug = slugifyField(patch.name as string);
          set(patch);
        }}
        hint="Sirf khali (ya last Qwen) fields auto-fill honge." />
    </Field>
    <FormField label="Embroidery options"><StringListEditor values={form.embroidery as string[]} onChange={(embroidery) => set({ embroidery })} placeholder="Add embroidery..." /></FormField>
    <FormField label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></FormField>
    <FormField label="Stock status"><Toggle label="In stock" checked={Boolean(form.inStock)} onChange={(inStock) => set({ inStock })} /></FormField>
  </>);
}

function LaceForm({ form, setForm, palette }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void; palette: PaletteColor[] }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  const pickColors = (chosen: PaletteColor[]) => {
    const primary =
      !isEmptyValue(form.colorName) || chosen.length === 0
        ? {}
        : { colorName: chosen[0].name, colorHex: chosen[0].hex };
    set({ colors: chosen, ...primary });
  };
  return (<>
    <Field label="Lace name"><TextInput required value={form.name as string} onChange={(e) => set({ name: e.target.value, slug: (form.slug as string) || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></Field>
    <Field label="Color name"><TextInput value={form.colorName as string} onChange={(e) => set({ colorName: e.target.value })} /></Field>
    <Field label="Color code">
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.colorHex as string) ? form.colorHex as string : '#cccccc'} onChange={(e) => set({ colorHex: e.target.value })} className="h-10 w-14 rounded border border-ink-light/30" />
        <TextInput className="flex-1" value={form.colorHex as string} onChange={(e) => set({ colorHex: e.target.value })} />
      </div>
    </Field>
    <FormField label="Color options" hint="Storefront par inhein hi choose kar sakte hain. Pehla default hota hai.">
      <ColorPaletteSelect palette={palette} value={(form.colors as PaletteColor[]) ?? []} onChange={pickColors} />
    </FormField>
    <Field label="Price (INR)"><TextInput type="number" min={0} required value={form.priceInr as number} onChange={(e) => set({ priceInr: Number(e.target.value) })} /></Field>
    <Field label="Image">
      <ImagePicker value={form.image ? [form.image as string] : []} onChange={(urls) => set({ image: urls[0] ?? '' })} max={1} />
      <QwenPicker endpoint="/admin/laces/generate-with-qwen" imageUrl={form.image as string}
        apply={(s, lastGen) => {
          const patch = mergeSuggestion(form, lastGen, s, ['name', 'colorName', 'colorHex', 'priceInr']);
          if (patch.name && isEmptyValue(form.slug)) patch.slug = slugifyField(patch.name as string);
          set(patch);
        }}
        hint="Sirf khali (ya last Qwen) fields auto-fill honge." />
    </Field>
    <FormField label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></FormField>
    <FormField label="Stock status"><Toggle label="In stock" checked={Boolean(form.inStock)} onChange={(inStock) => set({ inStock })} /></FormField>
  </>);
}

function LatkanForm({ form, setForm, palette }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void; palette: PaletteColor[] }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  const pickColors = (chosen: PaletteColor[]) => {
    const primary =
      !isEmptyValue(form.colorName) || chosen.length === 0
        ? {}
        : { colorName: chosen[0].name, colorHex: chosen[0].hex };
    set({ colors: chosen, ...primary });
  };
  return (<>
    <Field label="Latkan name"><TextInput required value={form.name as string} onChange={(e) => set({ name: e.target.value, slug: (form.slug as string) || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></Field>
    <Field label="Color name"><TextInput value={form.colorName as string} onChange={(e) => set({ colorName: e.target.value })} /></Field>
    <Field label="Color code">
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.colorHex as string) ? form.colorHex as string : '#cccccc'} onChange={(e) => set({ colorHex: e.target.value })} className="h-10 w-14 rounded border border-ink-light/30" />
        <TextInput className="flex-1" value={form.colorHex as string} onChange={(e) => set({ colorHex: e.target.value })} />
      </div>
    </Field>
    <FormField label="Color options" hint="Storefront par inhein hi choose kar sakte hain. Pehla default hota hai.">
      <ColorPaletteSelect palette={palette} value={(form.colors as PaletteColor[]) ?? []} onChange={pickColors} />
    </FormField>
    <Field label="Price (INR)"><TextInput type="number" min={0} required value={form.priceInr as number} onChange={(e) => set({ priceInr: Number(e.target.value) })} /></Field>
    <Field label="Image">
      <ImagePicker value={form.image ? [form.image as string] : []} onChange={(urls) => set({ image: urls[0] ?? '' })} max={1} />
      <QwenPicker endpoint="/admin/latkans/generate-with-qwen" imageUrl={form.image as string}
        apply={(s, lastGen) => {
          const patch = mergeSuggestion(form, lastGen, s, ['name', 'colorName', 'colorHex', 'priceInr']);
          if (patch.name && isEmptyValue(form.slug)) patch.slug = slugifyField(patch.name as string);
          set(patch);
        }}
        hint="Sirf khali (ya last Qwen) fields auto-fill honge." />
    </Field>
    <FormField label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></FormField>
    <FormField label="Stock status"><Toggle label="In stock" checked={Boolean(form.inStock)} onChange={(inStock) => set({ inStock })} /></FormField>
  </>);
}

function ColorForm({ form, setForm }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  return (<>
    <Field label="Color name"><TextInput required value={form.name as string} onChange={(e) => set({ name: e.target.value, slug: (form.slug as string) || e.target.value.toLowerCase().replace(/\s+/g, '-') })} /></Field>
    <Field label="Color code (hex)">
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.hex as string) ? form.hex as string : '#cccccc'} onChange={(e) => set({ hex: e.target.value })} className="h-10 w-14 rounded border border-ink-light/30" />
        <TextInput className="flex-1" value={form.hex as string} onChange={(e) => set({ hex: e.target.value })} />
      </div>
    </Field>
    <Field label="Swatch image URL"><TextInput value={form.image as string} onChange={(e) => set({ image: e.target.value })} /></Field>
    <FormField label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></FormField>
  </>);
}

function SizeForm({ form, setForm }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void }) {
  const set = (patch: Record<string, unknown>) => setForm({ ...form, ...patch });
  return (<>
    <Field label="Size name"><TextInput required value={form.label as string} onChange={(e) => set({ label: e.target.value })} /></Field>
    <Field label="Size value"><TextInput type="number" min={18} max={60} required value={form.value as number} onChange={(e) => set({ value: Number(e.target.value) })} /></Field>
    <FormField label="Price modifier (INR)" hint="Is size ke liye extra charge, agar koi ho"><TextInput type="number" min={0} value={form.priceModifierInr as number} onChange={(e) => set({ priceModifierInr: Number(e.target.value) })} /></FormField>
    <FormField label="Display order"><TextInput type="number" min={0} value={form.order as number} onChange={(e) => set({ order: Number(e.target.value) })} /></FormField>
  </>);
}