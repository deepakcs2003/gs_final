import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Empty, Toolbar } from './shared';
import { Check, Plus } from 'lucide-react';

export interface SettingDef {
  key: string;
  label: string;
  hint?: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'toggle';
  options?: Array<{ value: string; label: string }>;
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
          map[def.key] = found === undefined || found === null
            ? def.type === 'toggle' ? 'false' : def.options?.[0]?.value ?? ''
            : typeof found === 'object' ? JSON.stringify(found, null, 2) : String(found);
        }
        setValues(map);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Settings load nahi hue.'));
  };
  useEffect(() => { if (definitions.length) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [definitions.length]);

  const save = (def: SettingDef, raw?: string) => {
    void setBusy(def.key);
    const current = raw ?? values[def.key] ?? '';
    const value = def.type === 'number' ? Number(current) : def.type === 'toggle' ? current === 'true' : current;
    void api(`/admin/settings/${def.key}`, { method: 'PUT', body: { value } })
      .then(() => { setError(''); setSavedAt(def.key); setTimeout(() => setSavedAt(''), 1600); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  if (error) return <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div>;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {definitions.map((def) => {
        const on = values[def.key] === 'true';
        return (
        <div className="rounded-xl border border-maroon-100 p-4" key={def.key}>
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-semibold" htmlFor={`setting-${def.key}`}>{def.label}</label>
            <span className="font-mono text-[10px] text-ink-muted">{def.key}</span>
          </div>
          {def.hint ? <p className="mt-1 text-xs text-ink-muted">{def.hint}</p> : null}
          <div className="mt-3 flex gap-2">
            {def.type === 'toggle' ? (
              <button
                type="button"
                id={`setting-${def.key}`}
                aria-pressed={on}
                disabled={busy === def.key}
                onClick={() => {
                  const next = on ? 'false' : 'true';
                  setValues({ ...values, [def.key]: next });
                  save(def, next);
                }}
                className="flex min-h-[42px] items-center gap-2.5 rounded-xl border border-maroon-100 px-3 transition hover:bg-maroon-50"
              >
                <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-leaf' : 'bg-ink-light/30'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
                <span className={`text-[13px] font-bold ${on ? 'text-leaf' : 'text-ink-muted'}`}>
                  {on ? 'ON' : 'OFF'}
                  {savedAt === def.key ? ' ✓' : ''}
                </span>
              </button>
            ) : def.type === 'select' ? (
              <select id={`setting-${def.key}`} className="field min-h-[42px] flex-1" value={values[def.key] ?? ''} onChange={(e) => setValues({ ...values, [def.key]: e.target.value })} onBlur={() => save(def)}>
                {def.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <input id={`setting-${def.key}`} className="field min-h-[42px] flex-1" type={def.type === 'number' ? 'number' : 'text'} value={values[def.key] ?? ''} onChange={(e) => setValues({ ...values, [def.key]: e.target.value })} onBlur={() => save(def)} />
            )}
            {def.type !== 'toggle' ? (
              <BtnGhost className="min-h-[42px] px-3" disabled={busy === def.key} onClick={() => save(def)}>{savedAt === def.key ? <Check size={15} /> : 'Save'}</BtnGhost>
            ) : null}
          </div>
          {savedAt === def.key && def.type !== 'toggle' ? <p className="mt-1 text-xs font-semibold text-leaf">Saved ✓</p> : null}
        </div>
        );
      })}
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

const productionDefs: SettingDef[] = [
  { key: 'productionWorkingDays', label: 'Working days', hint: 'Comma separated, 0=Monday … 6=Sunday. e.g. 1,2,3,4,5,6 (Sunday off).', type: 'text' },
  { key: 'productionHolidays', label: 'Holidays', hint: 'Comma separated YYYY-MM-DD dates, e.g. 2026-01-26,2026-08-15.', type: 'text' },
  { key: 'productionComplexityUnits', label: 'Complexity units (JSON)', hint: 'Har complexity par stitching ka units — simple (≤1), bridal tak zyada.', type: 'textarea' },
  { key: 'productionPackingDays', label: 'Packing (working days)', type: 'number' },
  { key: 'productionStandardShippingDays', label: 'Standard shipping (calendar days)', hint: 'Estimate ke "to" date: stitching ke baad itne din shipping.', type: 'number' },
  { key: 'productionBufferDays', label: 'Buffer (working days)', hint: 'Thoda cushion rakhe taaki late na ho.', type: 'number' },
];

const accessoryDefs: SettingDef[] = [
  { key: 'laceColorPickerEnabled', label: 'Lace colour picker', hint: 'ON = lace par tap karte hi colour popup khulega. OFF = lace directly (exact same) add hogi — koi colour choice ya fabric matching nahi.', type: 'toggle' },
  { key: 'latkanColorPickerEnabled', label: 'Latkan colour picker', hint: 'ON = latkan par tap karte hi colour popup khulega. OFF = latkan directly (exact same) add hoga — koi colour choice ya fabric matching nahi.', type: 'toggle' },
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

      <div className="border-t border-maroon-100">
        <div className="px-4 pt-4">
          <h4 className="section-title">Production & stitching</h4>
          <p className="hint mt-1">Custom order estimates inhi settings se bante hain — Tailors module ke capacity se mil kar delivery range deta hai.</p>
        </div>
        <SettingsForm definitions={productionDefs} />
      </div>

      <div className="border-t border-maroon-100">
        <div className="px-4 pt-4">
          <h4 className="section-title">Lace & Latkan colour picker</h4>
          <p className="hint mt-1">Dono toggle independent hain. OFF hone par user ko colour-popup nahi dikhta aur lace/latkan bilkul waise hi add hote hain jaise catalog mein dikh rahe hain (exact item colour, koi fabric matching nahi).</p>
        </div>
        <SettingsForm definitions={accessoryDefs} />
      </div>

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