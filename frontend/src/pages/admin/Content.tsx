import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Empty, Field, Modal, TextArea, TextInput, Toolbar, Toggle } from './shared';
import { Check, Pencil, Trash2 } from 'lucide-react';

interface Page {
  _id: string; slug: string; title: string; content: string; seoTitle: string; seoDescription: string;
  isActive: boolean; updatedAt: string;
}

const emptyPage = (): Page => ({ _id: '', slug: '', title: '', content: '', seoTitle: '', seoDescription: '', isActive: true, updatedAt: '' });

export function ContentModule() {
  const [items, setItems] = useState<Page[]>([]);
  const [form, setForm] = useState<Page | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    void api<{ items: Page[] }>('/admin/pages')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Pages load nahi hue.'));
  };
  useEffect(() => { load(); }, []);

  const save = () => {
    if (!form) return;
    void setBusy(form._id || 'new');
    const { _id, updatedAt, ...values } = form;
    void api(`/admin/pages${_id ? `/${_id}` : ''}`, { method: _id ? 'PATCH' : 'POST', body: values })
      .then(() => { setForm(null); load(); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(''));
  };

  const remove = (id: string, slug: string) => {
    if (!confirm(`Page "${slug}" delete karein?`)) return;
    void setBusy(id);
    void api(`/admin/pages/${id}`, { method: 'DELETE' })
      .then(() => setItems((items) => items.filter((i) => i._id !== id)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'))
      .finally(() => setBusy(''));
  };

  const toggle = (page: Page) => {
    void api(`/admin/pages/${page._id}`, { method: 'PATCH', body: { isActive: !page.isActive } })
      .then(() => load())
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Update nahi hua.'));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Website content (pages)" count={items.length} onAdd={() => setForm(emptyPage())} addLabel="New page" />
      <p className="hint px-5 pb-2">About, FAQ, Contact, Shipping, Returns, Privacy policy etc. — har page ka apna slug hota hai. Storefront par /{'{slug}'} par dikhta hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Koi page nahi. About / FAQ / Contact banao." /></div> :
          items.map((page) => (
            <article className={`rounded-xl border p-4 ${page.isActive ? 'border-maroon-100 bg-white' : 'border-dashed border-ink-light/40 bg-ink-light/5 opacity-60'}`} key={page._id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-mono text-xs font-bold text-maroon-600">/{page.slug}</p><h4 className="mt-1 truncate font-semibold">{page.title}</h4></div>
                {page.isActive ? <Badge label="Live" /> : <Badge label="Hidden" />}
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{page.content || '(empty)'}</p>
              <p className="mt-1 text-[10px] text-ink-muted">Updated {new Date(page.updatedAt).toLocaleDateString('en-IN')}</p>
              <div className="mt-3 flex gap-2">
                <BtnGhost className="flex-1 px-3" onClick={() => setForm({ ...page })}><Pencil size={15} />Edit</BtnGhost>
                <BtnGhost className="px-3" onClick={() => toggle(page)}>{page.isActive ? 'Hide' : 'Show'}</BtnGhost>
                <BtnGhost className="px-3 text-alert" disabled={busy === page._id} onClick={() => remove(page._id, page.slug)}><Trash2 size={15} /></BtnGhost>
              </div>
            </article>
          ))}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit page' : 'New page'}
          footer={<div className="flex justify-end"><BtnPrimary onClick={save} disabled={busy === (form._id || 'new')}>{busy === (form._id || 'new') ? 'Saving...' : <><Check size={15} />Save</>}</BtnPrimary></div>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4">
            <Field label="Slug" hint="e.g. about-us, faq, contact"><TextInput required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></Field>
            <Field label="Page title"><TextInput required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Content" hint="Simple text — paragraphs se likhein."><TextArea className="min-h-[180px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
            <Field label="SEO title (max 70 chars)"><TextInput maxLength={70} value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} /></Field>
            <Field label="SEO description (max 180 chars)"><TextArea maxLength={180} value={form.seoDescription} onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} /></Field>
            <Toggle label="Visible on website" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} />
          </form>
        </Modal>
      ) : null}
    </section>
  );
}