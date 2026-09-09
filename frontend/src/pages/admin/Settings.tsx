import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Empty, Toolbar } from './shared';
import { Check, Plus } from 'lucide-react';

export interface SettingDef {
  key: string;
  label: string;
  hint?: string;
  type?: 'text' | 'number' | 'textarea';
}

interface SettingItem { key: string; value: unknown; updatedAt?: string }

/** Reusable settings editor — Shipping, Payments and SEO modules use it too. */
export function SettingsForm({ definitions }: { definitions: SettingDef[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  const load = () => {
    void api<{ items: SettingItem[] }>('/admin/settings')
      .then((res) => {
        setError('');
        const map: Record<string, string> = {};
        for (const def of definitions) {
          const found = res.items.find((i) => i.key === def.key)?.value;
          map[def.key] = found === undefined || found === null ? '' : typeof found === 'object' ? JSON.stringify(found, null, 2) : String(found);
        }
        setValues(map);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Settings load nahi hue.'));
  };
  useEffect(() => { if (definitions.length) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [definitions.length]);

  const save = (def: SettingDef) => {
    void setBusy(def.key);
    const raw = values[def.key] ?? '';
    const value = def.type === 'number' ? Number(raw) : raw;
    void api(`/admin/settings/${def.key}`, { method: 'PUT', body: { value } })
      .then(() => { setError(''); setSavedAt(def.key); setTimeout(() => setSavedAt(''), 1600); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  if (error) return <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div>;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {definitions.map((def) => (
        <div className="rounded-xl border border-maroon-100 p-4" key={def.key}>
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-semibold" htmlFor={`setting-${def.key}`}>{def.label}</label>
            <span className="font-mono text-[10px] text-ink-muted">{def.key}</span>
          </div>
          {def.hint ? <p className="mt-1 text-xs text-ink-muted">{def.hint}</p> : null}
          <div className="mt-3 flex gap-2">
            <input id={`setting-${def.key}`} className="field min-h-[42px] flex-1" type={def.type === 'number' ? 'number' : 'text'} value={values[def.key] ?? ''} onChange={(e) => setValues({ ...values, [def.key]: e.target.value })} onBlur={() => save(def)} />
            <BtnGhost className="min-h-[42px] px-3" disabled={busy === def.key} onClick={() => save(def)}>{savedAt === def.key ? <Check size={15} /> : 'Save'}</BtnGhost>
          </div>
          {savedAt === def.key ? <p className="mt-1 text-xs font-semibold text-leaf">Saved ✓</p> : null}
        </div>
      ))}
    </div>
  );
}

const businessDefs: SettingDef[] = [
  { key: 'whatsappNumber', label: 'WhatsApp number', hint: '10–15 digits, bina + ke. Enquiries aur order updates isi number se chat hote hain.', type: 'text' },
  { key: 'callNumber', label: 'Call number', type: 'text' },
  { key: 'usdRateInr', label: 'USD → INR rate', hint: 'International customers ko USD mein bill hota hai; ye rate se INR convert hota hai.', type: 'number' },
  { key: 'shippingFlatInr', label: 'Flat shipping charge (INR)', type: 'number' },
  { key: 'freeShippingAboveInr', label: 'Free shipping above (INR)', type: 'number' },
  { key: 'measurementInstructionVersion', label: 'Measurement guide version', hint: 'Har measurement change par version badhao taaki order par pata rahe kaunsi guide thi.', type: 'text' },
];

export function SettingsModule() {
  const [all, setAll] = useState<SettingItem[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadAll = () => {
    void api<{ items: SettingItem[] }>('/admin/settings')
      .then((res) => { setError(''); setAll(res.items); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Settings load nahi hue.'));
  };
  useEffect(() => { loadAll(); }, []);

  const addCustom = () => {
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
    if (!key) return;
    void setBusy('new');
    void api(`/admin/settings/${key}`, { method: 'PUT', body: { value: newValue } })
      .then(() => { setNewKey(''); setNewValue(''); loadAll(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Setting add nahi hui.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Website settings" count={businessDefs.length} />
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <SettingsForm definitions={businessDefs} />

      <div className="border-t border-maroon-100 p-4">
        <h4 className="section-title">Custom setting</h4>
        <p className="hint mt-1">Storefront ya payment integration ke liye koi aur key add karni ho (e.g. razorpayKeyId, seoTitle).</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="field min-h-[42px] font-mono sm:flex-1" placeholder="key_name" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className="field min-h-[42px] sm:flex-1" placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <BtnPrimary className="sm:flex-none" disabled={busy === 'new'} onClick={addCustom}><Plus size={16} />Add</BtnPrimary>
        </div>
      </div>

      <div className="border-t border-maroon-100 p-4">
        <h4 className="section-title">All stored settings <span className="text-base font-normal text-ink-muted">({all.length})</span></h4>
        {all.length === 0 ? <Empty message="Koi setting stored nahi hai." /> : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {all.map((item) => (
              <div className="rounded-lg border border-maroon-50 px-3 py-2 text-sm" key={item.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-maroon-700">{item.key}</span>
                  {item.updatedAt ? <span className="text-[10px] text-ink-muted">{new Date(item.updatedAt).toLocaleDateString('en-IN')}</span> : null}
                </div>
                <p className="mt-1 truncate text-xs text-ink-muted">{typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}