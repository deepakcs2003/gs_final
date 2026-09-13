import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnOutline, BtnPrimary, Checkbox, ColorPaletteSelect, Field, ImagePicker, Modal, PaletteColor, Select, StringListEditor, TextArea, TextInput, Toolbar, Toggle, inr, slugify } from './shared';
import { Archive, Copy, Plus, Pencil, X, Check, Sparkles } from 'lucide-react';
import { cloudinarySrc } from '../../lib/image';

export interface AdminCategory { _id: string; name: string; slug: string }
export interface AdminProduct {
  _id: string; designId: string; slug: string; name: string; description: string;
  type: 'READY_MADE' | 'CUSTOMIZE' | 'BOTH' | 'SHOWCASE';
  category: string | { _id: string; name: string };
  subCategory: string | null;
  tags: string[]; mrpInr: number; sellingPriceInr: number; codInitialPaymentPercent: number;
  images: Array<{ url: string; alt: string; kind: string }>;
  videoUrl: string; colors: Array<{ name: string; slug: string; hex: string }>;
  sizes: number[]; variants: Array<{ colorSlug: string; size: number; stock: number; sku: string }>;
  fabricOptions: string[]; laceOptions: string[]; latkanOptions: string[]; minFabricCount: number; maxFabricCount: number; minLaceCount: number; maxLaceCount: number; minLatkanCount: number; maxLatkanCount: number; stitchingChargeInr: number;
  fabricInfo: string; embroidery: string[]; careInstructions: string; stitchingInfo: string; stitchingDays: number;
  expectedAvailability: string; comingSoon: boolean;
  isActive: boolean; seo: { title: string; description: string; keywords: string[]; ogImage: string };
  stats?: Record<string, number>;
  createdAt?: string; updatedAt?: string;
  createdBy?: { _id?: string; name?: string; mobile?: string } | string | null;
}

const emptyProduct = (category = ''): AdminProduct => ({
  _id: '', designId: '', slug: '', name: '', description: '', type: 'READY_MADE', category,
  subCategory: null, tags: [], mrpInr: 0, sellingPriceInr: 0, images: [], videoUrl: '',
  colors: [], sizes: [], variants: [], fabricOptions: [], laceOptions: [], latkanOptions: [], minFabricCount: 1, maxFabricCount: 1, minLaceCount: 1, maxLaceCount: 1, minLatkanCount: 1, maxLatkanCount: 1, stitchingChargeInr: 0, codInitialPaymentPercent: 25,
  fabricInfo: '', embroidery: [], careInstructions: '', stitchingInfo: '', stitchingDays: 7,
  expectedAvailability: '', comingSoon: false, isActive: true, seo: { title: '', description: '', keywords: [], ogImage: '' },
});

/** What the backend's Qwen helper is allowed to fill — a subset of AdminProduct. */
/** What the backend's Qwen helper is allowed to fill — a subset of AdminProduct. */
interface QwenSuggestion {
  name: string | null;
  description: string | null;
  tags: string[] | null;
  embroidery: string[] | null;
  colors: Array<{ name: string; hex: string }> | null;
  categoryNames: string[] | null;
  priceInr: number | null;
  careInstructions: string | null;
  seo: { title: string | null; description: string | null; keywords: string[] | null } | null;
  categoryIds?: string[];
}

/** Coupon codes this product can be mapped to (from the Coupons & offers tab). */
interface AdminCoupon {
  _id: string; code: string; description: string; products: string[]; isActive: boolean;
}

export function ProductsModule({ initialProductId }: { initialProductId?: string } = {}) {
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [palette, setPalette] = useState<PaletteColor[]>([]);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [form, setForm] = useState<AdminProduct | null>(null);
  const [newEditor, setNewEditor] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [qwenBusy, setQwenBusy] = useState(false);
  const [qwenMsg, setQwenMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  /** Snapshot of what the last Qwen run wrote, so regenerating never clobbers manual edits. */
  const [lastGen, setLastGen] = useState<Record<string, unknown>>({});
  const targetRef = useRef(initialProductId ?? null);

  const load = async () => {
    setError('');
    try {
      const [productData, categoryData, colorData, couponData] = await Promise.all([
        api<{ items: AdminProduct[] }>('/admin/products?includeArchived=true'),
        api<{ items: AdminCategory[] }>('/admin/categories'),
        api<{ items: PaletteColor[] }>('/admin/colors'),
        api<{ items: AdminCoupon[] }>('/admin/coupons'),
      ]);
      setItems(productData.items);
      setCategories(categoryData.items);
      setPalette(colorData.items);
      setCoupons(couponData.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Products load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!initialProductId || !targetRef.current) return;
    targetRef.current = null;
    const cached = items.find((p) => p._id === initialProductId);
    if (cached) { openEdit(cached); return; }
    api<{ product: AdminProduct }>(`/admin/products/${initialProductId}`)
      .then((res) => openEdit(res.product))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Product kholte waqt gadbad.'));
  }, [items, initialProductId]);

  const isEmptyVal = (value: unknown): boolean => {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    return value === 0;
  };

  /** Keeps a manual edit unless the current value is empty or still the last AI value. */
  const mergeSuggest = (key: string, current: string | number, suggested: string | number | null | undefined) => {
    if (suggested === null || suggested === undefined) return current;
    if (isEmptyVal(current) || JSON.stringify(lastGen[key]) === JSON.stringify(current)) return suggested;
    return current;
  };
  const mergeArray = (key: string, current: string[], suggested: string[] | null | undefined) => {
    if (suggested === null || suggested === undefined) return current;
    if (current.length === 0 || JSON.stringify(lastGen[key]) === JSON.stringify(current)) return suggested;
    return current;
  };

  const generateWithQwen = async () => {
    if (!form) return;
    const imageUrls = form.images.map((img) => img.url);
    if (imageUrls.length === 0) { setQwenMsg({ type: 'err', text: 'Pehle product ki images add/upload karein.' }); return; }
    setQwenBusy(true);
    setQwenMsg(null);
    try {
      const res = await api<{ suggestion: QwenSuggestion }>('/admin/products/generate-with-qwen', {
        method: 'POST',
        body: { imageUrls },
      });
      const s = res.suggestion;
      const categoryIds = s.categoryIds ?? [];
      // Estimated price is only a guess — it fills the price field but never
      // touches MRP unless both are still empty, and is re-applied on regen
      // without clobbering a manual number. Showcase (upcoming) products have
      // no price editable in the form, so Qwen never touches it there.
      const aiPrice = typeof s.priceInr === 'number' && s.priceInr > 0 ? s.priceInr : null;
      const sellingPriceInr =
        form.type === 'SHOWCASE'
          ? form.sellingPriceInr
          : (aiPrice === null
              ? form.sellingPriceInr
              : (isEmptyVal(form.sellingPriceInr) || JSON.stringify(lastGen.sellingPriceInr) === JSON.stringify(form.sellingPriceInr)
                  ? aiPrice
                  : form.sellingPriceInr));
      const mrpInr = form.type === 'SHOWCASE' ? form.mrpInr : (form.mrpInr >= sellingPriceInr ? form.mrpInr : (form.mrpInr || sellingPriceInr));
      const next: AdminProduct = {
        ...form,
        mrpInr,
        sellingPriceInr,
        name: mergeSuggest('name', form.name, s.name) as string,
        description: mergeSuggest('description', form.description, s.description) as string,
        tags: mergeArray('tags', form.tags, s.tags ?? []),
        embroidery: mergeArray('embroidery', form.embroidery, s.embroidery ?? []),
        careInstructions: mergeSuggest('careInstructions', form.careInstructions, s.careInstructions) as string,
        colors: form.type === 'CUSTOMIZE'
          ? form.colors
          : (() => {
            if (!s.colors) return form.colors;
            // Only the FIRST (dominant) blouse colour is ever applied.
            const colors = s.colors.slice(0, 1).map((c) => ({ name: c.name, slug: slugify(c.name), hex: c.hex }));
            if (form.colors.length === 0 || JSON.stringify(lastGen.colors) === JSON.stringify(form.colors)) return colors;
            return form.colors;
          })(),
        category: mergeSuggest('category', String(form.category ?? ''), categoryIds[0] ?? '') as string,
        subCategory: (form.category ?? '') === (categoryIds[0] ?? '')
          ? form.subCategory
          : (form.subCategory ?? categoryIds[1] ?? form.subCategory),
        seo: {
          ...form.seo,
          title: mergeSuggest('seoTitle', form.seo.title, s.seo?.title ?? null) as string,
          description: mergeSuggest('seoDescription', form.seo.description, s.seo?.description ?? null) as string,
          keywords: mergeArray('seoKeywords', form.seo.keywords, s.seo?.keywords ?? []),
        },
      };
      setForm(next);
      setLastGen({
        name: next.name,
        description: next.description,
        tags: next.tags,
        embroidery: next.embroidery,
        careInstructions: next.careInstructions,
        colors: next.colors,
        category: String(next.category ?? ''),
        sellingPriceInr: next.sellingPriceInr,
        mrpInr: next.mrpInr,
        seoTitle: next.seo.title,
        seoDescription: next.seo.description,
        seoKeywords: next.seo.keywords,
      });
      setQwenMsg({ type: 'ok', text: 'Product details generated successfully.' });
    } catch (err) {
      setQwenMsg({ type: 'err', text: err instanceof ApiError ? err.message : 'AI generate nahi kar paya.' });
    } finally {
      setQwenBusy(false);
    }
  };

  /** Total sellable units — a product is Out of stock at 0, Low at ≤ 5. */
  const totalStock = (item: AdminProduct) => (item.variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: items.length };
    for (const item of items) {
      counts[item.isActive ? 'LIVE' : 'ARCHIVED'] = (counts[item.isActive ? 'LIVE' : 'ARCHIVED'] ?? 0) + 1;
      if (item.type === 'READY_MADE' || item.type === 'BOTH') {
        const stock = totalStock(item);
        if (stock <= 0) counts.OUT_OF_STOCK = (counts.OUT_OF_STOCK ?? 0) + 1;
        else if (stock <= 5) counts.LOW_STOCK = (counts.LOW_STOCK ?? 0) + 1;
      }
      if (item.comingSoon) counts.COMING_SOON = (counts.COMING_SOON ?? 0) + 1;
    }
    return counts;
  }, [items]);

  /** Status chips — admin ko Live/Archived/Out of stock sab ek nazar mein dikhta hai. */
  const STATUS_CHIPS: Array<{ id: string; label: string }> = [
    { id: 'ALL', label: 'All' },
    { id: 'LIVE', label: 'Live' },
    { id: 'ARCHIVED', label: 'Archived' },
    { id: 'OUT_OF_STOCK', label: 'Out of stock' },
    { id: 'LOW_STOCK', label: 'Low stock' },
    { id: 'COMING_SOON', label: 'Coming soon' },
  ];

  const filtered = useMemo(() => items.filter((item) =>
    (typeFilter === 'ALL' || item.type === typeFilter) &&
    (statusFilter === 'ALL'
      || (statusFilter === 'LIVE' && item.isActive)
      || (statusFilter === 'ARCHIVED' && !item.isActive)
      || (statusFilter === 'OUT_OF_STOCK' && (item.type === 'READY_MADE' || item.type === 'BOTH') && totalStock(item) <= 0)
      || (statusFilter === 'LOW_STOCK' && (item.type === 'READY_MADE' || item.type === 'BOTH') && totalStock(item) > 0 && totalStock(item) <= 5)
      || (statusFilter === 'COMING_SOON' && item.comingSoon)) &&
    `${item.designId} ${item.name} ${item.slug}`.toLowerCase().includes(query.toLowerCase()),
  ), [items, query, typeFilter, statusFilter]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Action complete nahi hua.'); } finally { setBusy(''); }
  };

  const save = () => {
    if (!form) return;
    if ((form.type === 'CUSTOMIZE' || form.type === 'BOTH') && (
      form.minFabricCount > form.maxFabricCount || form.minLaceCount > form.maxLaceCount || form.minLatkanCount > form.maxLatkanCount
    )) {
      setError('Har material ka minimum count maximum count se kam ya barabar hona chahiye.');
      return;
    }
    void run(form._id || 'new', async () => {
      // `seo` is editable; the rest are server-managed and would trip the
      // backend's strict schema (they come back from GET with the doc).
      const { _id, stats, createdAt, updatedAt, createdBy, ...values } = form;
      // Mongoose lean docs also carry rating/publishedAt/__v — drop them so the
      // backend's `.strict()` schemas never see an unknown key on PATCH.
      const clean = values as Record<string, unknown>;
      delete clean.rating;
      delete clean.publishedAt;
      delete clean.__v;
      const body = {
        ...values,
        ...(values.type === 'CUSTOMIZE' || values.type === 'BOTH' ? { fabricOptions: [], laceOptions: [], latkanOptions: [] } : {}),
        mrpInr: Number(values.mrpInr), sellingPriceInr: Number(values.sellingPriceInr), codInitialPaymentPercent: Number(values.codInitialPaymentPercent),
        stitchingChargeInr: Number(values.stitchingChargeInr), stitchingDays: Number(values.stitchingDays),
        minFabricCount: Number(values.minFabricCount), maxFabricCount: Number(values.maxFabricCount),
        minLaceCount: Number(values.minLaceCount), maxLaceCount: Number(values.maxLaceCount),
        minLatkanCount: Number(values.minLatkanCount), maxLatkanCount: Number(values.maxLatkanCount),
        colors: values.colors.filter((c) => c.name),
        variants: values.variants.map((v) => ({ ...v, size: Number(v.size), stock: Number(v.stock) })),
        images: values.images.filter((img) => img.url),
        category: typeof values.category === 'object' ? values.category._id : values.category,
      };
      if (_id) {
        const response = await api<{ product: AdminProduct }>(`/admin/products/${_id}`, { method: 'PATCH', body });
        setItems((items) => items.map((item) => item._id === response.product._id ? { ...response.product, category: categories.find((c) => c._id === response.product.category) ?? response.product.category } : item));
      } else {
        // Reload the list so the new row shows its auto design ID/slug plus the
        // creator + created date populated by the server.
        await api<{ product: AdminProduct }>('/admin/products', { method: 'POST', body });
        await load();
      }
      setForm(null);
      setNewEditor(false);
    });
  };

  const duplicate = (product: AdminProduct) => run(`dup-${product._id}`, async () => {
    const res = await api<{ product: AdminProduct }>(`/admin/products/${product._id}/duplicate`, { method: 'POST' });
    setItems((items) => [res.product, ...items]);
  });
  const archive = (product: AdminProduct) => run(`arc-${product._id}`, async () => {
    await api(`/admin/products/${product._id}`, { method: 'DELETE' });
    setItems((items) => items.map((item) => item._id === product._id ? { ...item, isActive: false } : item));
  });
  const toggleActive = (product: AdminProduct) => run(`tog-${product._id}`, async () => {
    const res = await api<{ product: AdminProduct }>(`/admin/products/${product._id}`, { method: 'PATCH', body: { isActive: !product.isActive } });
    setItems((items) => items.map((item) => item._id === res.product._id ? { ...item, isActive: res.product.isActive } : item));
  });

  const openNew = () => {
    // Empty material lists mean all active catalog materials on the storefront.
    setForm(emptyProduct(categories[0]?._id ?? ''));
    setNewEditor(true); setQwenMsg(null); setLastGen({});
  };
  const openEdit = (product: AdminProduct) => {
    const subCat = product.subCategory as { _id?: string } | string | null | undefined;
    setForm({
      ...product,
      category: typeof product.category === 'object' ? product.category._id : product.category,
      subCategory: typeof subCat === 'object' && subCat ? subCat._id ?? null : (typeof subCat === 'string' ? subCat : null),
      images: (product.images ?? []).map((img) => ({ ...img })),
      colors: (product.colors ?? []).map((c) => ({ ...c })),
      variants: (product.variants ?? []).map((v) => ({ ...v })),
      seo: product.seo ?? { title: '', description: '', keywords: [], ogImage: '' },
    });
    setNewEditor(false);
    setQwenMsg(null);
    setLastGen({});
  };

  const addVariant = () => {
    if (!form) return;
    const color = form.colors[0]?.slug ?? '';
    const size = form.sizes[0] ?? 34;
    setForm({ ...form, variants: [...form.variants, { colorSlug: color, size, stock: 0, sku: '' }] });
  };

  /**
   * Keeps the size × colour stock matrix in sync with the selected colours and
   * sizes: every colour × size combination gets a variant row (new combos start
   * at stock 10, existing ones keep their stock/SKU). Removed colours/sizes drop
   * their rows. Only meaningful for READY_MADE/BOTH — other types hold no inventory.
   */
  const withInventory = (current: AdminProduct, colors: AdminProduct['colors'], sizes: number[]): AdminProduct => {
    if (current.type !== 'READY_MADE' && current.type !== 'BOTH') return { ...current, colors, sizes, variants: [] };
    const existing = new Map<string, AdminProduct['variants'][number]>();
    for (const v of current.variants) {
      if (colors.some((c) => c.slug === v.colorSlug) && sizes.includes(v.size)) existing.set(`${v.colorSlug}|${v.size}`, v);
    }
    const variants: AdminProduct['variants'] = [];
    for (const color of colors) {
      for (const size of sizes) {
        const prior = existing.get(`${color.slug}|${size}`);
        variants.push(prior ?? { colorSlug: color.slug, size, stock: 10, sku: '' });
      }
    }
    return { ...current, colors, sizes, variants };
  };

  /** Maps/unmaps this product to/from a coupon by toggling the coupon's product list. */
  const toggleCouponForProduct = (coupon: AdminCoupon) => {
    if (!form?._id) return;
    const has = coupon.products.includes(form._id);
    const products = has ? coupon.products.filter((id) => id !== form._id) : [...coupon.products, form._id];
    void setBusy(`cpn-${coupon._id}`);
    void api(`/admin/coupons/${coupon._id}`, { method: 'PATCH', body: { products } })
      .then(() => setCoupons((cs) => cs.map((c) => (c._id === coupon._id ? { ...c, products } : c))))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Coupon update nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Product catalogue" count={filtered.length} searchPlaceholder="Search design, name or slug"
        query={query} onQuery={setQuery} onAdd={openNew} addLabel="New product" />
      <div className="flex flex-wrap gap-2 border-b border-maroon-100 px-5 py-3">
        {['ALL', 'READY_MADE', 'CUSTOMIZE', 'BOTH', 'SHOWCASE'].map((type) => (
          <button key={type} onClick={() => setTypeFilter(type)}
            className={`chip whitespace-nowrap ${typeFilter === type ? 'chip-active' : ''}`}>{type === 'BOTH' ? 'Ready + Custom' : type.replace('_', ' ')}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-maroon-100 bg-maroon-50/30 px-5 py-2">
        {STATUS_CHIPS.map((chip) => (
          <button key={chip.id} onClick={() => setStatusFilter(chip.id)} title={chip.id === 'OUT_OF_STOCK' ? 'Ready-made products jinki koi stock nahi bachi' : undefined}
            className={`chip whitespace-nowrap ${statusFilter === chip.id ? 'chip-active' : ''}`}>{chip.label} ({statusCounts[chip.id] ?? 0})</button>
        ))}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((product) => (
          <article key={product._id} className={`rounded-xl border p-4 ${product.isActive ? 'border-maroon-100 bg-white' : 'border-dashed border-ink-light/40 bg-ink-light/5 opacity-60'}`}>
            <div className="admin-row-stack items-start gap-3">
              {product.images?.[0]?.url ? (
                <img src={cloudinarySrc(product.images[0].url, 160)} alt={product.name} loading="lazy" className="h-14 w-14 shrink-0 rounded-lg border border-maroon-100 object-cover" />
              ) : (
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-dashed border-ink-light/40 bg-maroon-50/40 text-[10px] font-semibold text-ink-light">No img</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold tracking-wider text-maroon-600">{product.designId}</p>
                <h4 className="admin-text-wrap mt-0.5 font-semibold">{product.name}</h4>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge label={product.type.replace('_', ' ')} />
              {product.isActive ? <Badge label="Live" /> : <Badge label="Archived" />}
              {product.comingSoon ? <Badge label="Coming soon" /> : null}
              {product.type === 'READY_MADE' || product.type === 'BOTH' ? (() => {
                const stock = totalStock(product);
                if (stock <= 0) return <Badge label="Out of stock" tone="bg-alert/10 text-alert" />;
                if (stock <= 5) return <Badge label={`Low stock · ${stock}`} tone="bg-marigold-100 text-ink" />;
                return <Badge label={`${stock} units`} />;
              })() : null}
            </div>
            {product.createdAt ? (
              <p className="mt-2 truncate text-[11px] text-ink-muted">Added {new Date(product.createdAt).toLocaleDateString('en-IN')}
                {product.createdBy && typeof product.createdBy === 'object' && product.createdBy.mobile ? <> · by <span className="font-semibold">{product.createdBy.mobile}</span></> : null}
              </p>
            ) : null}
            {product.type === 'SHOWCASE' && product.sellingPriceInr <= 0
              ? <p className="mt-3 text-lg font-bold">Price on request</p>
              : <p className="mt-3 text-lg font-bold">{inr(product.sellingPriceInr * 100)} <span className="text-sm font-normal text-ink-light line-through">{inr(product.mrpInr * 100)}</span></p>}
            {(product.colors?.length ?? 0) > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">{product.colors.map((c) => <span key={c.slug} title={c.name} className="h-4 w-4 rounded-full border border-ink-light/40" style={{ backgroundColor: c.hex }} />)}</div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <BtnOutline className="min-w-0 flex-1 px-3" onClick={() => openEdit(product)}><Pencil size={15} />Edit</BtnOutline>
              <BtnGhost className="px-3" onClick={() => void duplicate(product)} disabled={busy === `dup-${product._id}`}><Copy size={15} /></BtnGhost>
              {product.isActive
                ? <BtnGhost className="px-3" onClick={() => void archive(product)} disabled={busy === `arc-${product._id}`} title="Archive"><Archive size={15} /></BtnGhost>
                : <BtnGhost className="px-3" onClick={() => void toggleActive(product)} disabled={busy === `tog-${product._id}`}><Check size={15} /></BtnGhost>}
            </div>
          </article>
        ))}
        {filtered.length === 0 ? <p className="col-span-full p-6 text-center text-ink-muted">Koi product nahi mila.</p> : null}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit product' : 'New product'}
          subtitle="Storefront details, pricing, variants aur SEO" maxWidth="sm:max-w-4xl"
          footer={<div className="flex justify-end gap-2"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={16} />Save product</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Design ID" hint="Khaali chhorein — auto generate hoga, e.g. GS-207"><TextInput value={form.designId} onChange={(e) => setForm({ ...form, designId: e.target.value.toUpperCase() })} /></Field>
            <Field label="Slug" hint="Khaali chhorein — name se auto generate hoga"><TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="Product name" hint="Khaali chhorein to design ID, e.g. GS-207, ban jayega" className="sm:col-span-2"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={form.type} onChange={(e) => {
              const type = e.target.value as AdminProduct['type'];
              // Switching to CUSTOMIZE with no fabrics chosen defaults to "all fabrics".
              const next = { ...form, type, fabricOptions: type === 'CUSTOMIZE' ? [] : form.fabricOptions };
              setForm(type === 'READY_MADE' || type === 'BOTH' ? withInventory(next, next.colors, next.sizes) : { ...next, variants: [] });
            }}>
              <option value="READY_MADE">Ready to Buy</option><option value="CUSTOMIZE">Customize</option><option value="BOTH">Ready + Customize</option><option value="SHOWCASE">Showcase / Upcoming</option>
            </Select></Field>
            <Field label="Category" hint="Khaali chhorne par pehli category lega"><Select value={typeof form.category === 'string' ? form.category : ''} onChange={(e) => setForm({ ...form, category: e.target.value, subCategory: null })}>
              <option value="">Select category</option>{categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select></Field>
            {form.type === 'SHOWCASE' ? null : (
              <>
                <Field label="MRP (INR)" hint="Khaali = selling price hi MRP maana jayega"><TextInput type="number" min={0} value={form.mrpInr} onChange={(e) => setForm({ ...form, mrpInr: Number(e.target.value) })} /></Field>
                <Field label="Selling price (INR)" hint="Required"><TextInput type="number" min={0} required value={form.sellingPriceInr} onChange={(e) => setForm({ ...form, sellingPriceInr: Number(e.target.value) })} /></Field>
                <Field label="COD initial payment (%)" hint="Delivery se pehle customer se kitna advance lena hai. 20–30% recommended."><TextInput type="number" min={0} max={100} value={form.codInitialPaymentPercent} onChange={(e) => setForm({ ...form, codInitialPaymentPercent: Number(e.target.value) })} /></Field>
                {(form.mrpInr > form.sellingPriceInr) ? <p className="text-sm font-bold text-leaf sm:col-span-2">Discount: {Math.round(((form.mrpInr - form.sellingPriceInr) / form.mrpInr) * 100)}% off</p> : null}
              </>
            )}
            <Field label="Description" className="sm:col-span-2"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Tags" className="sm:col-span-2"><StringListEditor values={form.tags} onChange={(tags) => setForm({ ...form, tags })} placeholder="Add tag..." /></Field>
            <Field label="Embroidery" className="sm:col-span-2"><StringListEditor values={form.embroidery} onChange={(embroidery) => setForm({ ...form, embroidery })} placeholder="Add embroidery type..." /></Field>

            {form.type !== 'CUSTOMIZE' ? (
              <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                <h4 className="text-sm font-bold text-maroon-700">Colors</h4>
                <Field label="Product colors" hint="Admin → Catalog → Colour se banaaye gaye palette se select karein. Multiple colours choose kar sakte hain — warranty/size se sirf pehla colour blouse ki dominant colour maana jaata hai.">
                  <ColorPaletteSelect palette={palette} value={form.colors}
                    onChange={(colors) => setForm(withInventory(form, colors.map((c) => ({ ...c, slug: slugify(c.name) })), form.sizes))} />
                </Field>
              </div>
            ) : null}

            {form.type === 'READY_MADE' || form.type === 'BOTH' ? (
              <>
                <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                  <h4 className="text-sm font-bold text-maroon-700">Sizes</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {form.sizes.map((size, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold">{size}
                        <button type="button" onClick={() => setForm(withInventory(form, form.colors, form.sizes.filter((_, j) => j !== i)))}><X size={12} /></button>
                      </span>
                    ))}
                    <input type="number" min={18} max={60} placeholder="Add size" className="field min-h-[38px] w-28 px-3 py-1.5 text-sm" onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value) { const size = Number((e.target as HTMLInputElement).value); e.preventDefault(); if (!form.sizes.includes(size)) setForm(withInventory(form, form.colors, [...form.sizes, size].sort((a, b) => a - b))); (e.target as HTMLInputElement).value = ''; }
                    }} />
                  </div>
                </div>

                <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                  <h4 className="text-sm font-bold text-maroon-700">Inventory (size × color stock)</h4>
                  <p className="mt-1 text-xs font-semibold text-ink-muted">Har colour × size combination ka row khud ban jaata hai — naye combination ka stock 10 hota hai. Yahan stock/sku update karein.</p>
                  <div className="mt-3 space-y-2">
                    {form.variants.map((variant, i) => (
                      <div className="flex items-center gap-2" key={i}>
                        <select className="field min-h-[40px] w-36 px-3 py-1.5 text-sm" value={variant.colorSlug} onChange={(e) => setForm({ ...form, variants: form.variants.map((v, j) => j === i ? { ...v, colorSlug: e.target.value } : v) })}>
                          <option value="">Color</option>{form.colors.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                        </select>
                        <select className="field min-h-[40px] w-24 px-3 py-1.5 text-sm" value={variant.size} onChange={(e) => setForm({ ...form, variants: form.variants.map((v, j) => j === i ? { ...v, size: Number(e.target.value) } : v) })}>
                          {form.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <TextInput type="number" min={0} className="w-24" placeholder="Stock" value={variant.stock} onChange={(e) => setForm({ ...form, variants: form.variants.map((v, j) => j === i ? { ...v, stock: Number(e.target.value) } : v) })} />
                        <TextInput className="flex-1" placeholder="SKU" value={variant.sku} onChange={(e) => setForm({ ...form, variants: form.variants.map((v, j) => j === i ? { ...v, sku: e.target.value } : v) })} />
                        <BtnGhost className="px-3" onClick={() => setForm({ ...form, variants: form.variants.filter((_, j) => j !== i) })}><X size={15} /></BtnGhost>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addVariant} className="btn-outline mt-3 min-h-[40px] w-full text-sm"><Plus size={14} />Add variant</button>
                </div>
              </>
            ) : null}

            {form.type === 'CUSTOMIZE' || form.type === 'BOTH' ? (
              <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                <h4 className="text-sm font-bold text-maroon-700">Customize options</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum fabric" hint="Default 1, maximum 6"><TextInput type="number" min={1} max={6} value={form.minFabricCount} onChange={(e) => setForm({ ...form, minFabricCount: Number(e.target.value) })} /></Field>
                  <Field label="Maximum fabric" hint="Default 1, maximum 6"><TextInput type="number" min={form.minFabricCount} max={6} value={form.maxFabricCount} onChange={(e) => setForm({ ...form, maxFabricCount: Number(e.target.value) })} /></Field>
                  <Field label="Minimum lace" hint="Default 1, 0 se shuru ho sakta hai, maximum 6"><TextInput type="number" min={0} max={6} value={form.minLaceCount} onChange={(e) => setForm({ ...form, minLaceCount: Number(e.target.value) })} /></Field>
                  <Field label="Maximum lace" hint="Default 1, maximum 6"><TextInput type="number" min={form.minLaceCount} max={6} value={form.maxLaceCount} onChange={(e) => setForm({ ...form, maxLaceCount: Number(e.target.value) })} /></Field>
                  <Field label="Minimum latkan" hint="Default 1, 0 se shuru ho sakta hai, maximum 6"><TextInput type="number" min={0} max={6} value={form.minLatkanCount} onChange={(e) => setForm({ ...form, minLatkanCount: Number(e.target.value) })} /></Field>
                  <Field label="Maximum latkan" hint="Default 1, maximum 6"><TextInput type="number" min={form.minLatkanCount} max={6} value={form.maxLatkanCount} onChange={(e) => setForm({ ...form, maxLatkanCount: Number(e.target.value) })} /></Field>
                  <Field label="Stitching charge (INR)"><TextInput type="number" min={0} value={form.stitchingChargeInr} onChange={(e) => setForm({ ...form, stitchingChargeInr: Number(e.target.value) })} /></Field>
                  <Field label="Stitching days" hint="Custom blouse kitne din mein ready hota hai"><TextInput type="number" min={0} max={90} value={form.stitchingDays} onChange={(e) => setForm({ ...form, stitchingDays: Number(e.target.value) })} /></Field>
                  <Field label="Fabric info"><TextInput value={form.fabricInfo} onChange={(e) => setForm({ ...form, fabricInfo: e.target.value })} /></Field>
                  <Field label="Stitching info" className="sm:col-span-2"><TextArea value={form.stitchingInfo} onChange={(e) => setForm({ ...form, stitchingInfo: e.target.value })} /></Field>
                  <Field label="Care instructions" className="sm:col-span-2"><TextArea value={form.careInstructions} onChange={(e) => setForm({ ...form, careInstructions: e.target.value })} /></Field>
                </div>

                <p className="mt-4 rounded-xl border border-maroon-100 bg-white/60 p-3 text-xs font-semibold text-ink-muted">Customer ko catalog ke saare active fabrics, laces aur latkans dikhaye jayenge. Upar diye counts se har blouse ke liye selection limit set karein.</p>
              </div>
            ) : null}

            {form.type === 'SHOWCASE' ? (
              <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
                <h4 className="text-sm font-bold text-maroon-700">Showcase options</h4>
                <div className="mt-3 space-y-3">
                  <Field label="Expected availability"><TextInput value={form.expectedAvailability} onChange={(e) => setForm({ ...form, expectedAvailability: e.target.value })} /></Field>
                  <Checkbox label="Coming soon (pre-order show only)" checked={form.comingSoon} onChange={(comingSoon) => setForm({ ...form, comingSoon })} />
                </div>
              </div>
            ) : null}

            <Field label="Video URL" className="sm:col-span-2"><TextInput value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} /></Field>
            <Field label="Product images" hint="Computer se upload karein ya URL se add karein. Pehli image main image hoti hai." className="sm:col-span-2">
              <ImagePicker value={form.images.map((img) => img.url)} max={10}
                onChange={(urls) => setForm({ ...form, images: urls.map((url) => ({ url, alt: form.name, kind: form.images.find((img) => img.url === url)?.kind ?? 'other' })) })} />
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-maroon-200 bg-maroon-50/40 p-3">
                <BtnPrimary type="button" onClick={() => void generateWithQwen()} disabled={qwenBusy || !form.images[0]?.url}>
                  <Sparkles size={16} />{qwenBusy ? 'Analyzing image...' : '✨ AI se analyse karein'}
                </BtnPrimary>
                <p className="text-xs text-ink-muted">Selected sabhi images (front/back/sleeve) se: name, description, tags, SINGLE dominant blouse colour, categories (pehla category, doosra sub-category), embroidery, approximate price, care instructions aur SEO auto-fill honge. Stock, sizes, SKU aur design ID aap khud bharo — ye kabhi overwrite nahi honge.</p>
              </div>
              {qwenMsg ? <p className={`mt-2 text-sm font-semibold ${qwenMsg.type === 'ok' ? 'text-leaf' : 'text-alert'}`}>{qwenMsg.type === 'ok' ? <><Check size={14} className="mr-1 inline" />{qwenMsg.text}</> : qwenMsg.text}</p> : null}
            </Field>

            <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
              <h4 className="text-sm font-bold text-maroon-700">SEO</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="SEO title" className="sm:col-span-2"><TextInput value={form.seo.title} onChange={(e) => setForm({ ...form, seo: { ...form.seo, title: e.target.value } })} /></Field>
                <Field label="Meta description" className="sm:col-span-2"><TextArea value={form.seo.description} onChange={(e) => setForm({ ...form, seo: { ...form.seo, description: e.target.value } })} /></Field>
                <Field label="Keywords" className="sm:col-span-2"><StringListEditor values={form.seo.keywords} onChange={(keywords) => setForm({ ...form, seo: { ...form.seo, keywords } })} placeholder="Add keyword..." /></Field>
                <Field label="OG image URL" className="sm:col-span-2"><TextInput value={form.seo.ogImage} onChange={(e) => setForm({ ...form, seo: { ...form.seo, ogImage: e.target.value } })} /></Field>
              </div>
            </div>

            <div className="sm:col-span-2 rounded-xl border border-maroon-100 bg-maroon-50/30 p-4">
              <h4 className="text-sm font-bold text-maroon-700">Coupons lagao</h4>
              {!form._id ? (
                <p className="mt-2 text-xs font-semibold text-ink-muted">Pehle product save karein — naye product par coupons sirf save ke baad map ho sakte hain.</p>
              ) : coupons.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-ink-muted">Koi coupon nahi. "Coupons & offers" tab se pehle coupon banayein.</p>
              ) : (
                <div className="mt-2 max-h-56 space-y-1.5 overflow-auto pr-1">
                  {coupons.map((coupon) => {
                    const global = (coupon.products ?? []).length === 0;
                    const mapped = !global && coupon.products.includes(form._id);
                    return (
                      <div key={coupon._id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${global ? 'border-dashed border-ink-light/40 bg-white/60' : 'border-maroon-100 bg-white'}`}>
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-bold tracking-wide text-maroon-700">{coupon.code}</p>
                          {coupon.description ? <p className="truncate text-[11px] text-ink-light">{coupon.description}</p> : null}
                          {global ? <p className="text-[11px] font-semibold text-ink-light">Sabhi products par chalta hai</p> : null}
                        </div>
                        {global ? (
                          <Badge label="All" />
                        ) : (
                          <button
                            type="button"
                            disabled={busy === `cpn-${coupon._id}`}
                            onClick={() => toggleCouponForProduct(coupon)}
                            className={`shrink-0 text-sm font-semibold ${mapped ? 'text-leaf' : 'text-maroon-600'}`}
                          >
                            {busy === `cpn-${coupon._id}` ? 'Saving...' : mapped ? <><Check size={14} className="mr-0.5 inline" />Mapped</> : 'Map karein'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4">
              <Toggle label="Product active (visible on storefront)" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
              {newEditor ? null : <button type="button" className="text-sm font-semibold text-alert" onClick={() => { if (confirm('Archive this product?')) { archive(form); setForm(null); } }}>Archive product</button>}
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
