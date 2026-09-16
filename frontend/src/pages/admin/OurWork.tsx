import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Pencil, RotateCcw, RotateCw, Sparkles, Trash2, Upload, X } from 'lucide-react';
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

type CropJob = { file: File; previewUrl: string };

function makeCroppedFile(job: CropJob, rotation: number, zoom: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const angle = ((rotation % 360) + 360) % 360;
      const radians = angle * Math.PI / 180;
      const rotatedWidth = angle === 90 || angle === 270 ? image.naturalHeight : image.naturalWidth;
      const rotatedHeight = angle === 90 || angle === 270 ? image.naturalWidth : image.naturalHeight;
      const cropWidth = Math.min(rotatedWidth, rotatedHeight * 0.8) / zoom;
      const cropHeight = cropWidth * 1.25;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropWidth);
      canvas.height = Math.round(cropHeight);
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('Image editor unavailable.')); return; }
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(radians);
      const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom;
      context.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Image crop nahi hua.')); return; }
        resolve(new File([blob], job.file.name.replace(/\.[^.]+$/, '') + '-edited.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    };
    image.onerror = () => reject(new Error('Image load nahi hui.'));
    image.src = job.previewUrl;
  });
}

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
  const [cropQueue, setCropQueue] = useState<CropJob[]>([]);
  const [cropJob, setCropJob] = useState<CropJob | null>(null);
  const [cropRotation, setCropRotation] = useState(0);
  const [cropZoom, setCropZoom] = useState(1);

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
      const { _id } = form;
      const images = form.images.map(({ url, publicId, width, height }, order) => ({
        url,
        publicId: publicId ?? '',
        width: width ?? 0,
        height: height ?? 0,
        order,
      }));
      const payload = {
        title: form.title,
        description: form.description,
        customerName: form.customerName,
        rating: form.rating,
        feedback: form.feedback,
        images,
        enquiryEnabled: form.enquiryEnabled,
        enquiryLabel: form.enquiryLabel,
        status: form.status,
        isPublished: form.isPublished,
        isDemo: form.isDemo,
        aiGenerated: form.aiGenerated,
        source: form.source,
        sortOrder: form.sortOrder,
      };
      await api(_id ? `/admin/our-work/${_id}` : '/admin/our-work', {
        method: _id ? 'PATCH' : 'POST',
        body: payload,
      });
      setForm(null);
      load();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fields ? Object.entries(e.fields).map(([field, message]) => `${field}: ${message}`).join(' | ') : '';
        setError(fields ? `${e.message} ${fields}` : e.message);
      } else {
        setError('Save nahi hua.');
      }
    } finally {
      setBusy(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files || !form) return;
    const jobs = Array.from(files).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setCropQueue(jobs.slice(1));
    setCropJob(jobs[0] ?? null);
    setCropRotation(0);
    setCropZoom(1);
  };

  const closeCropEditor = () => {
    if (cropJob) URL.revokeObjectURL(cropJob.previewUrl);
    cropQueue.forEach((job) => URL.revokeObjectURL(job.previewUrl));
    setCropJob(null);
    setCropQueue([]);
  };

  const useCroppedImage = async () => {
    if (!cropJob || !form) return;
    setBusy(true);
    setError('');
    try {
      const editedFile = await makeCroppedFile(cropJob, cropRotation, cropZoom);
      const uploaded = await uploadImages([editedFile]);
      setForm({ ...form, images: [...form.images, ...uploaded] });
      URL.revokeObjectURL(cropJob.previewUrl);
      const [nextJob, ...remaining] = cropQueue;
      setCropQueue(remaining);
      setCropJob(nextJob ?? null);
      setCropRotation(0);
      setCropZoom(1);
      if (!nextJob) setCropQueue([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Image upload nahi hua.');
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
      const customerNames = suggestion.customerNames
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .join(', ');

      setForm({
        ...form,
        title: suggestion.title ?? form.title,
        description: suggestion.description ?? form.description,
        feedback: suggestion.feedback ?? form.feedback,
        customerName: customerNames || form.customerName,
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
        <Modal open onClose={() => { closeCropEditor(); setForm(null); }} title={form._id ? 'Edit Our Work' : 'New Our Work'} subtitle="Customer name aur feedback mix-language (Hindi, English, Marathi/other Indian languages) mein ho sakte hain." maxWidth="sm:max-w-2xl" footer={<div className="flex justify-end gap-2"><BtnGhost onClick={() => setForm(null)}>Cancel</BtnGhost><BtnPrimary disabled={busy} onClick={() => void save()}><Check size={16} />{busy ? 'Saving...' : 'Save'}</BtnPrimary></div>}>
          <div className="space-y-4 pb-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title / design name"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Customer name"><TextInput value={form.customerName} placeholder="Aarohi, Riya, Sneha, Anaya, Shreya, Meher, Isha" onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
            </div>
            <Field label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rating (1-10)"><TextInput type="number" min="1" max="10" value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Enquiry button text"><TextInput value={form.enquiryLabel} onChange={(e) => setForm({ ...form, enquiryLabel: e.target.value })} /></Field>
            </div>
            <Field label="Feedback / WhatsApp messages"><TextArea value={form.feedback} placeholder="Example: Bahut sundar hai || Looks beautiful || Khup chan aahe || So pretty || Amazing work ||" onChange={(e) => setForm({ ...form, feedback: e.target.value })} /></Field>

            <div className="flex flex-wrap gap-2">
              <label className="btn-outline cursor-pointer"><Upload size={16} />Upload & edit images<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} /></label>
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

      {cropJob ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/70 p-3" role="dialog" aria-modal="true" aria-label="Edit image">
          <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-maroon-600">Image editor</p><h2 className="mt-1 font-display text-2xl font-bold">Crop & rotate</h2><p className="mt-1 text-sm text-ink-muted">Frame ke andar ka area upload hoga.</p></div>
              <button type="button" className="btn-ghost shrink-0" aria-label="Close image editor" onClick={closeCropEditor}><X size={20} /></button>
            </div>
            <div className="relative mx-auto mt-5 aspect-[4/5] max-h-[55vh] overflow-hidden rounded-xl bg-ink/10">
              <img src={cropJob.previewUrl} alt="Crop preview" className="absolute inset-0 h-full w-full object-contain transition-transform" style={{ transform: `rotate(${cropRotation}deg) scale(${cropZoom})` }} />
              <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[0_0_0_9999px_rgba(20,12,15,0.38)]" />
            </div>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button type="button" className="btn-outline" onClick={() => setCropRotation((value) => value - 90)} title="Rotate left"><RotateCcw size={17} />Left</button>
              <button type="button" className="btn-outline" onClick={() => setCropRotation((value) => value + 90)} title="Rotate right"><RotateCw size={17} />Right</button>
            </div>
            <label className="mt-5 block text-sm font-semibold text-ink">Zoom <span className="font-normal text-ink-muted">{cropZoom.toFixed(1)}x</span><input className="mt-2 w-full accent-maroon-700" type="range" min="1" max="3" step="0.1" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} /></label>
            {cropQueue.length ? <p className="mt-3 text-center text-xs font-semibold text-ink-muted">{cropQueue.length} aur image{cropQueue.length === 1 ? '' : 's'} baaki</p> : null}
            <div className="mt-5 flex justify-end gap-2"><BtnGhost onClick={closeCropEditor}>Cancel</BtnGhost><BtnPrimary disabled={busy} onClick={() => void useCroppedImage()}>{busy ? 'Uploading...' : 'Use image'}</BtnPrimary></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
