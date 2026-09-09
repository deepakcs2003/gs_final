import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BtnPrimary, Toolbar } from './shared';
import { DatabaseBackup, Download, Package, ClipboardList, Users, Gauge } from 'lucide-react';

interface ExportDef { kind: string; label: string; desc: string; icon: typeof Package }

const exportsDef: ExportDef[] = [
  { kind: 'products', label: 'Products', desc: 'Pura catalogue — prices, inventory, SEO, sab', icon: Package },
  { kind: 'orders', label: 'Orders', desc: 'Recent 500 orders, items, payments, shipping', icon: ClipboardList },
  { kind: 'customers', label: 'Customers', desc: 'User profiles — contact, focused stats', icon: Users },
  { kind: 'inventory', label: 'Inventory', desc: 'Fabrics (metres), laces, latkan aur ready-to-buy stock', icon: Gauge },
];

export function BackupModule() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  const download = async (kind: string) => {
    void setBusy(kind);
    setError('');
    const path = kind === 'inventory' ? 'inventory' : kind;
    try {
      const payload = await api<{ items: unknown }>(`/admin/export/${path}`);
      const items = payload.items;
      setCounts((c) => ({ ...c, [kind]: Array.isArray(items) ? items.length : Object.keys(items as Record<string, unknown>).reduce((n, k) => n + (((items as Record<string, unknown>)[k] as unknown[])?.length ?? 0), 0) }));
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guddisilai-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export nahi hua.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Backup & export" count={Object.keys(exportsDef).length} />
      <p className="hint px-5 pb-2">Kisi bhi waqt data ka full snapshot download karein. JSON file aap apne Drive/PC par rakh sakte hain — koi bhi badi galti ka undo yahi hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {exportsDef.map((def) => {
          const Icon = def.icon;
          return (
            <article className="rounded-xl border border-maroon-100 p-5" key={def.kind}>
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-maroon-50 text-maroon-700"><Icon size={22} /></div>
              <h4 className="mt-3 font-semibold">{def.label}</h4>
              <p className="mt-1 text-xs text-ink-muted">{def.desc}</p>
              {counts[def.kind] !== undefined ? <p className="mt-2 text-sm font-bold text-leaf">{counts[def.kind]} records downloaded ✓</p> : null}
              <BtnPrimary className="mt-4 w-full" disabled={busy === def.kind} onClick={() => void download(def.kind)}>
                {busy === def.kind ? 'Exporting...' : <><Download size={16} />Download JSON</>}
              </BtnPrimary>
            </article>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-maroon-100 p-4 text-sm text-ink-muted">
        <DatabaseBackup size={18} className="text-maroon-600" />
        <span>Har hafte ek baar export karke rakhna best practice hai. Data MongoDB database ke andar safe rehta hai; ye downloads extra suraksha ke liye hain.</span>
      </div>
    </section>
  );
}