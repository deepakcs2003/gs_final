import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Empty, Field, Modal, Select, TextInput, Toolbar, Toggle } from './shared';
import { SettingsForm, type SettingDef } from './Settings';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react';

interface HomeSection {
  _id: string; key: string; title: string; subtitle: string;
  type: string; isActive: boolean; order: number; productIds: string[];
  categoryId: string | null; maxProducts: number; buttonText: string; buttonLink: string;
}

const emptySection = (key: string, title: string): HomeSection => ({
  _id: '', key, title, subtitle: '', type: 'CUSTOM', isActive: true, order: 0,
  productIds: [], categoryId: null, maxProducts: 8, buttonText: 'View All', buttonLink: '/',
});

const sectionPresets: Array<{ key: string; title: string; type: string }> = [
  { key: 'ready_to_buy', title: 'Ready to Buy', type: 'READY_MADE' },
  { key: 'customize', title: 'Customize Your Blouse', type: 'CUSTOMIZE' },
  { key: 'new_designs', title: 'Upcoming / New Designs', type: 'NEW' },
  { key: 'trending', title: 'Trending Designs', type: 'TRENDING' },
  { key: 'featured', title: 'Featured Collection', type: 'FEATURED' },
  { key: 'showcase', title: 'Upcoming / Showcase', type: 'SHOWCASE' },
];

const feedSettingDefs: SettingDef[] = [
  {
    key: 'homeFeedMode',
    label: 'Product feed mode',
    hint: 'Sequential mein ek type ke saare products ke baad next type aata hai. Mixed mein sab types popularity ke hisaab se milte hain.',
    type: 'select',
    options: [
      { value: 'SEQUENTIAL', label: 'Sequential: Customize → Ready-made → Upcoming' },
      { value: 'MIXED', label: 'Mixed: sab types together' },
    ],
  },
  {
    key: 'homeFeedOrder',
    label: 'Sequential type order',
    hint: 'Comma-separated selected types. Example: CUSTOMIZE,READY_MADE,SHOWCASE. Type hataoge to woh homepage feed mein nahi dikhega.',
    type: 'text',
  },
  {
    key: 'homeFeedPageSize',
    label: 'Products per infinite-scroll batch',
    hint: '6 se 30 ke beech. Bada number fewer loading steps dikhata hai.',
    type: 'number',
  },
];

export function HomepageModule() {
  const [items, setItems] = useState<HomeSection[]>([]);
  const [form, setForm] = useState<HomeSection | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: HomeSection[] }>('/admin/homepage-sections');
      setItems(res.items.sort((a, b) => a.order - b.order));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Sections load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const save = () => {
    if (!form) return;
    void setBusy(form._id || 'new');
    const { _id, ...values } = form;
    const body = { ...values, order: Number(values.order), maxProducts: Number(values.maxProducts) };
    void api(`/admin/homepage-sections${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body })
      .then(() => { setForm(null); void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const addPreset = (key: string, title: string) => {
    // New sections append to the end — a fresh "Customize" preset should never
    // silently jump to the top of the homepage.
    setForm({ ...emptySection(key, title), order: items.length });
  };

  const remove = (id: string) => {
    if (!confirm('Section delete karein?')) return;
    void api(`/admin/homepage-sections/${id}`, { method: 'DELETE' })
      .then(() => { void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const reordered = next.map((item, i) => ({ ...item, order: i }));
    setItems(reordered);
    void setBusy('reorder');
    void Promise.all(reordered.map((item) => api(`/admin/homepage-sections/${item._id}`, { method: 'PATCH', body: { order: item.order } })))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Reorder nahi hua.'))
      .finally(() => setBusy(''));
  };

  const existingKeys = new Set(items.map((i) => i.key));

  return (
    <>
      <section className="card mb-4 overflow-hidden">
        <Toolbar title="Homepage product feed" count={feedSettingDefs.length} />
        <p className="hint px-5 pb-2">Customize, ready-made aur upcoming products ka order, mix aur infinite-scroll size yahan control karein.</p>
        <SettingsForm definitions={feedSettingDefs} />
      </section>
      <section className="card overflow-hidden">
      <Toolbar title="Homepage sections" count={items.length} onAdd={() => setForm({ ...emptySection(`custom_${Date.now()}`, 'New Section'), order: items.length })} addLabel="Add section" />
      <p className="hint px-5 pb-2">Homepage par kis sequence mein kya dikhega — drag-order system. Titles, subtitles, button text sab change kar sakte hain.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="space-y-3 p-4">
        {items.length === 0 ? <Empty message="Koi section nahi. Presets add karein." /> : items.map((section, index) => (
          <article className={`flex items-center gap-3 rounded-xl border p-4 ${section.isActive ? 'border-maroon-100 bg-white' : 'border-dashed border-ink-light/40 bg-ink-light/5 opacity-60'}`} key={section._id}>
            <div className="flex flex-col gap-1">
              <BtnGhost className="min-h-8 px-2 disabled:opacity-30" disabled={index === 0 || busy === 'reorder'} onClick={() => move(index, -1)}><ArrowUp size={14} /></BtnGhost>
              <BtnGhost className="min-h-8 px-2 disabled:opacity-30" disabled={index === items.length - 1 || busy === 'reorder'} onClick={() => move(index, 1)}><ArrowDown size={14} /></BtnGhost>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink-light">#{section.order + 1}</span>
                <p className="truncate font-semibold">{section.title}</p>
                {section.type !== 'CUSTOM' ? <span className="shrink-0 rounded-full bg-maroon-50 px-2 py-0.5 text-[10px] font-bold text-maroon-700">{section.type.replace('_', ' ')}</span> : null}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${section.isActive ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'}`}>{section.isActive ? 'Showing' : 'Hidden'}</span>
              </div>
              {section.subtitle ? <p className="mt-0.5 truncate text-xs text-ink-muted">{section.subtitle}</p> : null}
              <p className="mt-0.5 text-xs text-ink-muted">Button: <strong>{section.buttonText}</strong> → {section.buttonLink} · {section.maxProducts} products</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <BtnGhost className="min-h-9 px-2.5" onClick={() => setForm({ ...section })}><Pencil size={14} /></BtnGhost>
              <BtnGhost className="min-h-9 px-2.5 text-alert" onClick={() => remove(section._id)}><Trash2 size={14} /></BtnGhost>
            </div>
          </article>
        ))}
        <div className="pt-2">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">Presets</p>
          <div className="flex flex-wrap gap-2">
            {sectionPresets.filter((p) => !existingKeys.has(p.key)).map((preset) => (
              <button key={preset.key} onClick={() => addPreset(preset.key, preset.title)} className="chip"><Plus size={14} />{preset.title}</button>
            ))}
          </div>
        </div>
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title="Homepage section"
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Section title"><TextInput required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Subtitle"><TextInput value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></Field>
            <Field label="Section type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="READY_MADE">Ready to Buy</option><option value="CUSTOMIZE">Customize</option>
              <option value="SHOWCASE">Showcase</option><option value="TRENDING">Trending</option>
              <option value="NEW">New Designs</option><option value="FEATURED">Featured</option><option value="CUSTOM">Manual</option>
            </Select></Field>
            <Field label="Display order"><TextInput type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
            <Field label="Max products to show"><TextInput type="number" min={1} max={50} value={form.maxProducts} onChange={(e) => setForm({ ...form, maxProducts: Number(e.target.value) })} /></Field>
            <Field label="Button text"><TextInput value={form.buttonText} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} /></Field>
            <Field label="Button link"><TextInput value={form.buttonLink} onChange={(e) => setForm({ ...form, buttonLink: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Show on homepage" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /></div>
          </form>
        </Modal>
      ) : null}
      </section>
    </>
  );
}