import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Empty, Toolbar, inr } from './shared';
import { AlertTriangle } from 'lucide-react';

interface ProductInventory { _id: string; designId: string; name: string; type: string; variants: Array<{ colorSlug: string; size: number; stock: number; sku: string }>; colors: Array<{ name: string; slug: string; hex: string }> }
interface FabricInventory { _id: string; name: string; material: string; colorName: string; stockMeters: number; inStock: boolean }
interface LaceInventory { _id: string; name: string; colorName: string; inStock: boolean; priceInr: number }
interface LatkanInventory { _id: string; name: string; colorName: string; inStock: boolean; priceInr: number }

export function InventoryModule() {
  const [products, setProducts] = useState<ProductInventory[]>([]);
  const [fabrics, setFabrics] = useState<FabricInventory[]>([]);
  const [laces, setLaces] = useState<LaceInventory[]>([]);
  const [latkans, setLatkans] = useState<LatkanInventory[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: { fabrics: FabricInventory[]; laces: LaceInventory[]; latkans: LatkanInventory[]; products: ProductInventory[] } }>('/admin/export/inventory');
      setFabrics(res.items.fabrics); setLaces(res.items.laces); setLatkans(res.items.latkans); setProducts(res.items.products);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Inventory load nahi hua.'); }
  };
  useEffect(() => { void load(); }, []);

  const productStock = useMemo(() => products.map((p) => {
    const total = p.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0);
    const q = query.toLowerCase();
    const matches = `${p.designId} ${p.name}`.toLowerCase().includes(q);
    return { ...p, total, low: total <= 5, matches };
  }).filter((p) => p.matches).sort((a, b) => a.total - b.total), [products, query]);

  const fabricMatches = fabrics.filter((f) => `${f.name} ${f.material} ${f.colorName}`.toLowerCase().includes(query.toLowerCase()));
  const laceMatches = laces.filter((l) => `${l.name} ${l.colorName}`.toLowerCase().includes(query.toLowerCase()));
  const latkanMatches = latkans.filter((l) => `${l.name} ${l.colorName}`.toLowerCase().includes(query.toLowerCase()));

  const lowProductCount = productStock.filter((p) => p.low && p.total > 0).length;

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <Toolbar title="Ready-to-buy stock" count={productStock.length} searchPlaceholder="Search design..." query={query} onQuery={setQuery} />
        {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
        {lowProductCount > 0 ? (
          <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-alert/30 bg-alert/5 p-3 text-sm">
            <AlertTriangle size={16} className="shrink-0 text-alert" /><span className="min-w-0 font-semibold text-alert">{lowProductCount} products ki stock 5 se kam hai.</span>
          </div>
        ) : null}
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {productStock.length === 0 ? <div className="col-span-full"><Empty message="Koi product nahi." /></div> :
            productStock.map((p) => (
              <article key={p._id} className={`rounded-xl border p-4 ${p.total === 0 ? 'border-alert/30 bg-alert/5' : p.low ? 'border-marigold-500/50' : 'border-maroon-100'}`}>
                <div className="admin-row-stack items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-maroon-600">{p.designId}</p><h4 className="admin-text-wrap font-semibold">{p.name}</h4></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${p.total === 0 ? 'bg-alert text-white' : p.low ? 'bg-marigold-500 text-ink' : 'bg-leaf/15 text-leaf'}`}>
                    {p.total === 0 ? 'Out of stock' : `${p.total} left`}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                  {p.variants.slice(0, 12).map((v, i) => {
                    const color = p.colors.find((c) => c.slug === v.colorSlug);
                    return (
                      <div key={i} className={`flex items-center justify-between gap-1.5 rounded-md px-2 py-1 ${v.stock === 0 ? 'bg-alert/10 text-alert' : v.stock <= 3 ? 'bg-marigold-100 text-ink' : 'bg-maroon-50 text-ink'}`}>
                        <span className="admin-text-wrap min-w-0 font-semibold">{color?.name ?? v.colorSlug} · {v.size}</span> <strong className="shrink-0">{v.stock}</strong>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <Toolbar title="Fabric stock (metres)" count={fabricMatches.length} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {fabricMatches.length === 0 ? <div className="col-span-full"><Empty message="Koi fabric nahi." /></div> : fabricMatches.map((f) => (
              <article key={f._id} className="rounded-xl border border-maroon-100 bg-white p-4 shadow-card transition hover:border-maroon-200">
                <div className="admin-row-stack items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><p className="admin-text-wrap font-semibold text-ink">{f.name}</p><p className="admin-text-wrap text-xs text-ink-muted">{f.material} · {f.colorName}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${f.stockMeters === 0 || !f.inStock ? 'bg-alert/10 text-alert' : 'bg-leaf/15 text-leaf'}`}>
                    {f.inStock ? `${f.stockMeters} m` : 'Out of stock'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card overflow-hidden">
          <Toolbar title="Lace stock" count={laceMatches.length} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {laceMatches.length === 0 ? <div className="col-span-full"><Empty message="Koi lace nahi." /></div> : laceMatches.map((l) => (
              <article key={l._id} className="rounded-xl border border-maroon-100 bg-white p-4 shadow-card transition hover:border-maroon-200">
                <div className="admin-row-stack items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><p className="admin-text-wrap font-semibold text-ink">{l.name}</p><p className="admin-text-wrap text-xs text-ink-muted">{l.colorName} · {inr(l.priceInr * 100)}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${l.inStock ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'}`}>{l.inStock ? 'In stock' : 'Out of stock'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card overflow-hidden">
          <Toolbar title="Latkan stock" count={latkanMatches.length} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {latkanMatches.length === 0 ? <div className="col-span-full"><Empty message="Koi latkan nahi." /></div> : latkanMatches.map((l) => (
              <article key={l._id} className="rounded-xl border border-maroon-100 bg-white p-4 shadow-card transition hover:border-maroon-200">
                <div className="admin-row-stack items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><p className="admin-text-wrap font-semibold text-ink">{l.name}</p><p className="admin-text-wrap text-xs text-ink-muted">{l.colorName} · {inr(l.priceInr * 100)}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${l.inStock ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'}`}>{l.inStock ? 'In stock' : 'Out of stock'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}