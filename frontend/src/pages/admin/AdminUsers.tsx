import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Empty, Field, Modal, TextInput, Toolbar } from './shared';
import { Check, Pencil, ShieldCheck, Trash2 } from 'lucide-react';

const ROLES = ['SUPER_ADMIN', 'PRODUCT_MANAGER', 'ORDER_MANAGER', 'STITCHING_MANAGER', 'ANALYST'] as const;
type Role = (typeof ROLES)[number];

const roleHints: Record<Role, string> = {
  SUPER_ADMIN: 'Sab kuch — staff aur settings bhi',
  PRODUCT_MANAGER: 'Products, catalogue, coupons, banners, homepage',
  ORDER_MANAGER: 'Orders, shipping, payments, customers',
  STITCHING_MANAGER: 'Stitching sheet, measurements, custom orders',
  ANALYST: 'Sirf analytics aur activity dekhe',
};

interface StaffUser { _id: string; name: string; mobile: string; email: string; adminRoles: Role[]; isBlocked: boolean; lastLoginAt: string | null; createdAt: string }

interface StaffForm { _id: string; name: string; mobile: string; roles: Role[] }

const emptyForm = (): StaffForm => ({ _id: '', name: '', mobile: '', roles: ['ORDER_MANAGER'] });

export function AdminUsersModule() {
  const [items, setItems] = useState<StaffUser[]>([]);
  const [form, setForm] = useState<StaffForm | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    void api<{ items: StaffUser[] }>('/admin/admin-users')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Staff load nahi hua.'));
  };
  useEffect(() => { load(); }, []);

  const save = () => {
    if (!form || form.roles.length === 0) { setError('Kam se kam ek role to chahiye.'); return; }
    void setBusy(form._id || 'new');
    const { _id, ...values } = form;
    void api(`/admin/admin-users${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body: values })
      .then(() => { setForm(null); load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (staff: StaffUser) => {
    if (!confirm(`${staff.name || staff.mobile} ko staff se hatayein?`)) return;
    void setBusy(staff._id);
    void api(`/admin/admin-users/${staff._id}`, { method: 'DELETE' })
      .then(() => setItems((items) => items.filter((i) => i._id !== staff._id)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Remove nahi hua.'))
      .finally(() => setBusy(''));
  };

  const toggleBlock = (staff: StaffUser) => {
    void setBusy(staff._id);
    void api(`/admin/admin-users/${staff._id}`, { method: 'PATCH', body: { isBlocked: !staff.isBlocked } })
      .then(() => load())
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Admin users & roles" count={items.length} onAdd={() => setForm(emptyForm())} addLabel="Add staff" />
      <p className="hint px-5 pb-2">Roles control karte hain koi kaun si screen dekh/use kar sakta hai. Sirf Super Admin roles change kar sakta hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-maroon-50 text-ink-muted"><tr>
            <th className="p-4">Staff</th><th className="p-4">Roles</th><th className="p-4">Status</th><th className="p-4">Last login</th><th className="p-4" />
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={5}><Empty message="Koi staff member nahi." /></td></tr> :
              items.map((staff) => (
                <tr className="border-t border-maroon-100" key={staff._id}>
                  <td className="p-4"><strong>{staff.name || '—'}</strong><div className="text-xs text-ink-muted">{staff.mobile}{staff.email ? ` · ${staff.email}` : ''}</div></td>
                  <td className="p-4"><div className="flex flex-wrap gap-1">{staff.adminRoles.map((role) => <Badge key={role} label={role} />)}</div></td>
                  <td className="p-4">{staff.isBlocked ? <Badge label="Blocked" /> : <Badge label="Active" />}</td>
                  <td className="p-4 text-xs text-ink-muted">{staff.lastLoginAt ? new Date(staff.lastLoginAt).toLocaleString('en-IN') : 'Never'}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1.5">
                      <BtnGhost className="min-h-9 px-2.5" onClick={() => setForm({ _id: staff._id, name: staff.name ?? '', mobile: staff.mobile, roles: staff.adminRoles })}><Pencil size={14} /></BtnGhost>
                      <BtnGhost className="min-h-9 px-2.5" disabled={busy === staff._id} onClick={() => toggleBlock(staff)}>{staff.isBlocked ? 'Unblock' : 'Block'}</BtnGhost>
                      <BtnGhost className="min-h-9 px-2.5 text-alert" disabled={busy === staff._id} onClick={() => remove(staff)}><Trash2 size={14} /></BtnGhost>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit staff' : 'Add staff'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile number" hint="Is number se staff login karega"><TextInput required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
              <Field label="Name" hint="Optional"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            </div>
            <Field label="Roles" hint="Kam se kam ek role zaroori hai">
              <div className="mt-2 space-y-2 rounded-xl border border-maroon-100 p-4">
                {ROLES.map((role) => (
                  <label className="flex cursor-pointer items-center gap-3" key={role}>
                    <input type="checkbox" checked={form.roles.includes(role)} onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, role] : form.roles.filter((r) => r !== role) })}
                      className="h-5 w-5 rounded border-ink-light/40 text-maroon-600 focus:ring-maroon-500" />
                    <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className="text-maroon-600" />{role.replace(/_/g, ' ')}</span><span className="text-xs text-ink-muted">{roleHints[role]}</span></span>
                  </label>
                ))}
              </div>
            </Field>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}