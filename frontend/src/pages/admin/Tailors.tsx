import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Field, Modal, TextInput } from './shared';
import { Pencil, Plus, Scissors, X, UserRound, Package, CalendarCheck } from 'lucide-react';

const statusOptions = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;

const specLabels: Record<string, string> = {
  simple_blouse: 'Simple blouse',
  designer_blouse: 'Designer blouse',
  bridal_blouse: 'Bridal blouse',
  other: 'Other',
};

const specCodes = Object.keys(specLabels);

interface TailorRow {
  _id: string; name: string; status: string; mobile: string; email: string; address: string;
  specializationCaps: Array<{ code: string; capacityPerDay: number }>;
  experienceYears: number; workingDays: number[]; workingHours: string; notes: string;
  workload: { assignedOrders: number; assignedUnits: number };
}

interface TailorDashboard {
  tailors: Array<{ tailor: TailorRow; workload: { assignedOrders: number; assignedUnits: number } }>;
  totalActiveTailors: number;
  pendingWorkload: { orders: number; units: number };
  awaitingTailorCount: number;
}

export function TailorsModule() {
  const [dashboard, setDashboard] = useState<TailorDashboard | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<TailorRow | null>(null);

  const load = async () => {
    setError('');
    try {
      const res = await api<TailorDashboard>('/admin/tailor-dashboard');
      setDashboard(res);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Dashboard load nahi hua.'); }
  };
  useEffect(() => { void load(); }, []);

  const tailors = dashboard?.tailors ?? [];

  const createTailor = async (body: Record<string, unknown>) => {
    setBusy('create');
    try {
      await api('/admin/tailors', { method: 'POST', body });
      setModal(null);
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Tailor create nahi hua.'); }
    finally { setBusy(''); }
  };

  const updateTailor = async (id: string, body: Record<string, unknown>) => {
    setBusy('edit');
    try {
      await api(`/admin/tailors/${id}`, { method: 'PATCH', body });
      setModal(null);
      setEditing(null);
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Tailor update nahi hua.'); }
    finally { setBusy(''); }
  };

  const deactivateTailor = async (id: string, name: string) => {
    if (!window.confirm(`${name} ko deactivate karna hai?`)) return;
    setBusy(id);
    try {
      await api(`/admin/tailors/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Deactivate nahi hua.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DashCard icon={<UserRound size={18} />} label="Active tailors" value={dashboard?.totalActiveTailors ?? 0} />
        <DashCard icon={<Package size={18} />} label="Pending (no tailor)" value={dashboard?.pendingWorkload.orders ?? 0} sub={`${dashboard?.pendingWorkload.units ?? 0} units`} />
        <DashCard icon={<Scissors size={18} />} label="Awaiting review" value={dashboard?.awaitingTailorCount ?? 0} sub="Orders ready for assignment" />
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-maroon-100 bg-maroon-50/50 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-maroon-700">Tailors</h3>
            <p className="mt-1 text-xs text-ink-muted">Capacity per specialisation, workload aur working days.</p>
          </div>
          <BtnPrimary onClick={() => { setEditing(null); setModal('create'); }}><Plus size={15} />Add tailor</BtnPrimary>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-maroon-50 text-ink-muted"><tr>
              <th className="p-4">Tailor</th><th className="p-4">Status</th><th className="p-4">Workload</th><th className="p-4">Caps</th><th className="p-4">Days</th><th className="p-4">Actions</th>
            </tr></thead>
            <tbody>
              {tailors.length === 0 ? <tr><td className="p-6 text-center text-ink-muted" colSpan={6}>Koi tailor nahi. Add karein.</td></tr> : tailors.map(({ tailor, workload }) => (
                <tr className="border-t border-maroon-100 hover:bg-maroon-50/30" key={tailor._id}>
                  <td className="p-4">
                    <p className="font-semibold">{tailor.name}</p>
                    <p className="text-xs text-ink-muted">{tailor.mobile}</p>
                    {tailor.experienceYears ? <p className="text-xs text-ink-muted">{tailor.experienceYears} yrs</p> : null}
                  </td>
                  <td className="p-4"><Badge label={tailor.status} /></td>
                  <td className="p-4">{workload.assignedOrders} orders / {workload.assignedUnits} units</td>
                  <td className="p-4 text-xs text-ink-muted">{tailor.specializationCaps.map((c) => `${specLabels[c.code] ?? c.code} ${c.capacityPerDay}/day`).join(', ') || '—'}</td>
                  <td className="p-4 text-xs text-ink-muted">{tailor.workingDays.map((d) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join(' ')}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <BtnGhost className="min-h-8 px-2 text-xs" onClick={() => { setEditing(tailor); setModal('edit'); }}><Pencil size={13} />Edit</BtnGhost>
                      {tailor.status !== 'INACTIVE' ? (
                        <BtnGhost className="min-h-8 px-2 text-xs text-alert" onClick={() => void deactivateTailor(tailor._id, tailor.name)}>Deactivate</BtnGhost>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="section-title flex items-center gap-2"><CalendarCheck size={17} />Production settings</h3>
        <p className="mt-2 text-sm text-ink-muted">Production config (complexity units, working days, holidays) aap Website Settings → Production me dekh sakte hain.</p>
      </section>

      {modal ? (
        <TailorModal
          open={modal !== null} onClose={() => { setModal(null); setEditing(null); }}
          tailor={modal === 'edit' ? editing : null} busy={busy === 'create' || busy === 'edit'}
          onCreate={createTailor} onUpdate={updateTailor}
        />
      ) : null}
    </div>
  );
}

function DashCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-maroon-600">{icon}<p className="text-sm text-ink-muted">{label}</p></div>
      <p className="mt-2 text-2xl font-bold text-maroon-700">{value}</p>
      {sub ? <p className="mt-1 text-xs text-ink-muted">{sub}</p> : null}
    </div>
  );
}

interface TailorModalProps {
  open: boolean; onClose: () => void; tailor: TailorRow | null; busy: boolean;
  onCreate: (body: Record<string, unknown>) => void; onUpdate: (id: string, body: Record<string, unknown>) => void;
}

function TailorModal({ open, onClose, tailor, busy, onCreate, onUpdate }: TailorModalProps) {
  const [name, setName] = useState(tailor?.name ?? '');
  const [mobile, setMobile] = useState(tailor?.mobile ?? '');
  const [email, setEmail] = useState(tailor?.email ?? '');
  const [address, setAddress] = useState(tailor?.address ?? '');
  const [experienceYears, setExperienceYears] = useState(tailor?.experienceYears ?? 0);
  const [workingDays, setWorkingDays] = useState<number[]>(tailor?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const [workingHours, setWorkingHours] = useState(tailor?.workingHours ?? '10:00–18:00');
  const [status, setStatus] = useState<string>(tailor?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(tailor?.notes ?? '');
  const [caps, setCaps] = useState<Array<{ code: string; capacityPerDay: number }>>(tailor?.specializationCaps ?? [{ code: 'simple_blouse', capacityPerDay: 2 }]);

  const toggleDay = (d: number) => setWorkingDays((days) => days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  const updateCap = (i: number, field: string, value: string | number) => setCaps((prev) => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  const addCap = () => setCaps((prev) => [...prev, { code: 'other', capacityPerDay: 1 }]);
  const removeCap = (i: number) => setCaps((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    const body: Record<string, unknown> = {
      name: name.trim(), mobile: mobile.trim(), email: email.trim(), address: address.trim(),
      experienceYears, workingDays, workingHours, status, notes,
      specializationCaps: caps.filter((c) => c.capacityPerDay > 0),
    };
    if (tailor) onUpdate(tailor._id, body);
    else onCreate(body);
  };

  return (
    <Modal open={open} onClose={onClose} title={tailor ? `Edit: ${tailor.name}` : 'Naya tailor'} subtitle="Assigning orders se pehle tailor add karein" maxWidth="sm:max-w-lg"
      footer={<div className="flex justify-end gap-2"><BtnGhost onClick={onClose}><X size={15} />Cancel</BtnGhost><BtnPrimary onClick={submit} disabled={busy || !name.trim()}>{busy ? 'Saving...' : tailor ? 'Save' : 'Create'}</BtnPrimary></div>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Tailor name" /></Field>
          <Field label="Mobile"><TextInput value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91..." /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email"><TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></Field>
          <Field label="Experience (years)"><TextInput type="number" value={experienceYears} onChange={(e) => setExperienceYears(Number(e.target.value))} /></Field>
        </div>
        <Field label="Address"><TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Working hours"><TextInput value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} placeholder="10:00–18:00" /></Field>
        <div>
          <p className="mb-1.5 text-xs font-bold text-ink-muted">Working days</p>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${workingDays.includes(d) ? 'border-maroon-500 bg-maroon-50 text-maroon-700' : 'border-ink-light/30 text-ink-muted'}`}>
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Status">
          <select className="field min-h-10 w-full text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal note" /></Field>
        <div>
          <p className="mb-2 text-xs font-bold text-ink-muted">Specialisation capacity</p>
          {caps.map((cap, i) => (
            <div className="mb-2 flex items-center gap-2" key={i}>
              <select className="field min-h-9 w-auto py-1 text-xs" value={cap.code} onChange={(e) => updateCap(i, 'code', e.target.value)}>
                {specCodes.map((c) => <option key={c} value={c}>{specLabels[c]}</option>)}
              </select>
              <TextInput type="number" value={cap.capacityPerDay} onChange={(e) => updateCap(i, 'capacityPerDay', Number(e.target.value))} className="h-9 w-20 text-xs" />
              <span className="text-[10px] text-ink-muted">per day</span>
              {caps.length > 1 ? <BtnGhost className="min-h-8 px-2 text-xs text-alert" onClick={() => removeCap(i)}>×</BtnGhost> : null}
            </div>
          ))}
          <button type="button" onClick={addCap} className="mt-1 text-xs font-semibold text-maroon-700 hover:underline">+ Add specialisation</button>
        </div>
      </div>
    </Modal>
  );
}
