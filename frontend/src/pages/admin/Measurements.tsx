import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BtnGhost, BtnPrimary, Checkbox, Empty, Field, Modal, TextArea, TextInput, Toolbar, Toggle } from './shared';
import { Pencil, Trash2, Check, X } from 'lucide-react';

interface MeasurementField {
  _id: string; key: string; label: string; labelHi: string; instruction: string;
  gifUrl: string; imageUrl: string; minInch: number; maxInch: number;
  required: boolean; order: number; isActive: boolean;
}

const emptyField = (): MeasurementField => ({
  _id: '', key: '', label: '', labelHi: '', instruction: '', gifUrl: '', imageUrl: '',
  minInch: 10, maxInch: 60, required: true, order: 0, isActive: true,
});

export function MeasurementsModule() {
  const [items, setItems] = useState<MeasurementField[]>([]);
  const [form, setForm] = useState<MeasurementField | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await api<{ items: MeasurementField[] }>('/admin/measurements');
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Measurements load nahi hue.'); }
  };
  useEffect(() => { void load(); }, []);

  const save = () => {
    if (!form) return;
    void setBusy(form._id || 'new');
    const { _id, ...values } = form;
    const path = `/admin/measurements${_id ? `/${_id}` : ''}`;
    void api(path, { method: _id ? 'PATCH' : 'POST', body: values })
      .then(() => { setForm(null); void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string) => {
    if (!confirm('Measurement field delete karein?')) return;
    void setBusy(id);
    void api(`/admin/measurements/${id}`, { method: 'DELETE' })
      .then(() => { setItems((items) => items.filter((i) => i._id !== id)); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'))
      .finally(() => setBusy(''));
  };

  const toggle = (field: MeasurementField) => {
    void setBusy(field._id);
    void api(`/admin/measurements/${field._id}`, { method: 'PATCH', body: { isActive: !field.isActive } })
      .then(() => { void load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Measurement fields" count={items.length} onAdd={() => setForm(emptyField())} addLabel="Add field" />
      <p className="hint px-5 pb-2">Customer se kaun-kaun se measurements lene hain ye aap decide karte hain. Field add/remove/rename/reorder sab yahin se hota hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="divide-y divide-maroon-100">
        {items.length === 0 ? <Empty message="Koi measurement field nahi hai." /> :
          items.map((field) => (
            <div className="flex items-center justify-between gap-3 px-5 py-3" key={field._id}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-maroon-50 text-xs font-bold text-maroon-700">{field.order}</span>
                  <span className="font-semibold">{field.label}</span>
                  {field.required ? <span className="rounded bg-maroon-50 px-1.5 py-0.5 text-[10px] font-bold text-maroon-700">REQUIRED</span> : null}
                  {!field.isActive ? <span className="rounded bg-alert/10 px-1.5 py-0.5 text-[10px] font-bold text-alert">INACTIVE</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  <span className="font-mono">{field.key}</span> · {field.labelHi || '—'} · {field.minInch}"–{field.maxInch}"
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <BtnGhost className="min-h-9 px-2.5" onClick={() => setForm({ ...field })}><Pencil size={14} /></BtnGhost>
                <BtnGhost className="min-h-9 px-2.5" disabled={busy === field._id} onClick={() => toggle(field)}>{field.isActive ? <X size={14} /> : <Check size={14} />}</BtnGhost>
                <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === field._id} onClick={() => remove(field._id)}><Trash2 size={14} /></BtnGhost>
              </div>
            </div>
          ))}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit measurement' : 'New measurement'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" hint="Unique lowercase identifier, e.g. bust"><TextInput required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_') })} /></Field>
            <Field label="Order"><TextInput type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></Field>
            <Field label="Label"><TextInput required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <Field label="Hindi helper (Hinglish)" hint="e.g. Chaati ka sabse chauda part"><TextInput value={form.labelHi} onChange={(e) => setForm({ ...form, labelHi: e.target.value })} /></Field>
            <Field label="Instruction" className="sm:col-span-2"><TextArea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} /></Field>
            <Field label="Measure GIF URL"><TextInput value={form.gifUrl} onChange={(e) => setForm({ ...form, gifUrl: e.target.value })} /></Field>
            <Field label="Measure image URL"><TextInput value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></Field>
            <Field label="Minimum (inches)"><TextInput type="number" min={1} max={120} value={form.minInch} onChange={(e) => setForm({ ...form, minInch: Number(e.target.value) })} /></Field>
            <Field label="Maximum (inches)"><TextInput type="number" min={1} max={120} value={form.maxInch} onChange={(e) => setForm({ ...form, maxInch: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2 flex gap-6">
              <Checkbox label="Required" checked={form.required} onChange={(required) => setForm({ ...form, required })} />
              <Toggle label="Active" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}