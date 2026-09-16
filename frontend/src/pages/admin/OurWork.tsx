import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Pencil, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError, uploadImages, type UploadedFile } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Field, Modal, TextArea, TextInput, Toolbar } from './shared';

interface WorkItem {
  _id: string;
  title: string;
  description: string;
  customerName: string;
  rating: number | null;
  feedback: string;
  images: UploadedFile[];
  enquiryEnabled: boolean;
  enquiryLabel: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  isPublished: boolean;
  isDemo: boolean;
  aiGenerated: boolean;
  source: 'ADMIN' | 'CUSTOMER' | 'WHATSAPP_MESSAGE';
  sortOrder: number;
}

type Suggestion = {
  title?: string | null;
  description?: string | null;
  feedback?: string | null;
  customerNames?: string | null;
};

const emptyWork = (): WorkItem => ({
  _id: '', title: '', description: '', customerName: '', rating: null, feedback: '', images: [],
  enquiryEnabled: true, enquiryLabel: 'Enquire Now', status: 'APPROVED', isPublished: false,
  isDemo: false, aiGenerated: false, source: 'ADMIN', sortOrder: 0,
});

export function OurWorkModule() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [form, setForm] = useState<WorkItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    void api<{ items: WorkItem[] }>('/admin/our-work')
      .then((result) => setItems(result.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Our Work load nahi hua.'));
  };

  useEffect(load, []);

  const save = async () => {
    if (!form || form.images.length === 0) {
      setError('Kam se kam ek image upload karein.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(form._id ? `/admin/our-work/${form._id}` : '/admin/our-work', {
        method: form._id ? 'PATCH' : 'POST',
        body: { ...form, images: form.images.map((image, order) => ({ ...image, order })) },
      });
      setForm(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save nahi hua.');
    } finally {
      setBusy(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files || !form) return;
    setBusy(true);
    try {
      const uploaded = await uploadImages(Array.from(files));
      setForm({ ...form, images: [...form.images, ...uploaded] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload nahi hua.');
    } finally {
      setBusy(false);
    }
  };

  const makeMainImage = (index: number) => {
    if (!form || index === 0) return;
    const images = [...form.images];
    const [mainImage] = images.splice(index, 1);
    if (mainImage) images.unshift(mainImage);
    setForm({ ...form, images });
  };

  const generate = async () => {
    if (!form?.images.length) {
      setError('Pehle images upload karein.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ suggestion: Suggestion }>('/admin/our-work/generate-with-qwen', {
        method: 'POST',
        body: { imageUrls: form.images.map((image) => image.url) },
      });
      const suggestion = result.suggestion;
      setForm({
        ...form,
        title: suggestion.title ?? form.title,
        description: suggestion.description ?? form.description,
        feedback: suggestion.feedback ?? form.feedback,
        customerName: suggestion.customerNames ?? form.customerName,
        source: 'WHATSAPP_MESSAGE',
        isDemo: false,
        aiGenerated: false,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Photos se details nahi aa paayi.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: WorkItem) => {
    if (!window.confirm('Is Our Work entry ko delete karein?')) return;
    await api(`/admin/our-work/${item._id}`, { method: 'DELETE' });
    load();
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Our Work / Hamara Kaam" count={items.length} onAdd={() => { setError(''); setForm(emptyWork()); }} addLabel="New work" />
      {error ? <p className="mx-5 mt-4 rounded-xl bg-alert/10 p-3 text-sm font-semibold text-alert">{error}</p> : null}
      <div className="divide-y divide-maroon-100">
        {items.map((item) => (
          <div key={item._id} className="flex gap-3 p-4">
            <img src={item.images[0]?.url} className="h-20 w-16 rounded-lg object-cover" alt="" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold">{item.title || 'Untitled work'}</h4>
                <Badge label={item.status} />
                {item.isPublished ? <Badge label="PUBLISHED" /> : null}
                {item.source === 'WHATSAPP_MESSAGE' ? <Badge label="WHATSAPP MESSAGE" /> : null}
              </div>
              <p className="mt-1 text-xs text-ink-muted">{item.source === 'CUSTOMER' ? 'Customer submission' : item.source === 'WHATSAPP_MESSAGE' ? 'WhatsApp message' : 'Admin entry'}{item.customerName ? ` · ${item.customerName}` : ''}{item.rating ? ` · ${item.rating}/10` : ''}</p>
            </div>
            <div className="flex items-start gap-1">
              <BtnGhost onClick={() => setForm(item)} title="Edit"><Pencil size={17} /></BtnGhost>
              <BtnGhost onClick={() => void remove(item)} title="Delete"><Trash2 size={17} /></BtnGhost>
            </div>
          </div>
        ))}
      </div>

      {form ? (
        <Modal open onClose={() => setForm(null)} title={form._id ? 'Edit Our Work' : 'New Our Work'} subtitle="WhatsApp messages ko customer names ke saath comma se alag likhein." maxWidth="sm:max-w-2xl" footer={<div className="flex justify-end gap-2"><BtnGhost onClick={() => setForm(null)}>Cancel</BtnGhost><BtnPrimary disabled={busy} onClick={() => void save()}><Check size={16} />{busy ? 'Saving...' : 'Save'}</BtnPrimary></div>}>
          <div className="space-y-4 pb-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title / design name"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Customer name"><TextInput value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
            </div>
            <Field label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rating (1-10)"><TextInput type="number" min="1" max="10" value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Enquiry button text"><TextInput value={form.enquiryLabel} onChange={(e) => setForm({ ...form, enquiryLabel: e.target.value })} /></Field>
            </div>
            <Field label="Feedback / WhatsApp messages"><TextArea value={form.feedback} placeholder="Har message alag line ya || se likhein" onChange={(e) => setForm({ ...form, feedback: e.target.value })} /></Field>

            <div className="flex flex-wrap gap-2">
              <label className="btn-outline cursor-pointer"><Upload size={16} />Upload images<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => void addImages(e.target.files)} /></label>
              <BtnPrimary onClick={() => void generate()} disabled={busy}><Sparkles size={16} />Fill from photos</BtnPrimary>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Gallery images</p>
              <p className="mb-3 text-xs text-ink-muted">Jo image main banani ho, uske neeche “Make main” dabayein. First image storefront cover hogi.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {form.images.map((image, index) => (
                  <div key={image.url} className="overflow-hidden rounded-lg border border-maroon-100 bg-cream">
                    <img src={image.url} alt={`Work image ${index + 1}`} className="aspect-square w-full object-cover" />
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      <button type="button" className={`flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-1 text-[11px] font-bold ${index === 0 ? 'bg-marigold-500 text-ink' : 'text-maroon-700 hover:bg-maroon-50'}`} onClick={() => makeMainImage(index)} disabled={index === 0} title={index === 0 ? 'Main image' : 'Make this the main image'}>
                        <ImageIcon size={13} />{index === 0 ? 'Main' : 'Make main'}
                      </button>
                      <button type="button" className="rounded p-1 text-alert hover:bg-alert/10" aria-label="Remove image" onClick={() => setForm({ ...form, images: form.images.filter((_, imageIndex) => imageIndex !== index) })}><X size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {form.source === 'WHATSAPP_MESSAGE' ? <p className="rounded-lg bg-leaf/10 p-3 text-xs font-semibold text-leaf">Source: WhatsApp message</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked, status: e.target.checked ? 'APPROVED' : form.status })} />Published and approved</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enquiryEnabled} onChange={(e) => setForm({ ...form, enquiryEnabled: e.target.checked })} />Show WhatsApp enquiry</label>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
