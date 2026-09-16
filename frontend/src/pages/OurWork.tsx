import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, MessageCircle, Quote, Star, Upload, UserRound, X } from 'lucide-react';
import { api, ApiError, uploadOurWorkImages, type UploadedFile } from '../lib/api';
import { useConfig } from '../hooks/queries';
import { whatsappEnquiryUrl } from '../lib/format';

interface WorkItem { _id: string; title: string; description: string; customerName: string; rating: number | null; feedback: string; images: UploadedFile[]; enquiryEnabled: boolean; enquiryLabel: string; isDemo: boolean; aiGenerated: boolean; source?: 'ADMIN' | 'CUSTOMER' | 'WHATSAPP_MESSAGE'; }

const names = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean);
const messages = (value: string) => value.split(/\s*\|\|\s*|\r?\n/).map((entry) => entry.trim()).filter(Boolean);

function Rating({ value, compact = false }: { value: number | null; compact?: boolean }) {
  if (!value) return null;
  const stars = Math.round(value / 2);
  return <div className={`flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-sm'}`} aria-label={`${value} out of 10 rating`}>
    <span className="flex text-marigold-500">{Array.from({ length: 5 }, (_, index) => <Star key={index} size={compact ? 12 : 15} fill={index < stars ? 'currentColor' : 'none'} strokeWidth={index < stars ? 1.5 : 1.8} />)}</span>
    <span className="font-bold text-ink">{value}/10</span>
  </div>;
}

export function OurWorkPage() {
  const { data: config } = useConfig();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [slide, setSlide] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [form, setForm] = useState({ name: '', rating: '', feedback: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => { void api<{ items: WorkItem[] }>('/our-work').then((result) => setItems(result.items)); };
  useEffect(load, []);

  const submit = async () => {
    if (!form.rating || !form.feedback.trim() || files.length === 0) { setMessage('Rating, feedback aur kam se kam ek image zaroori hai.'); return; }
    setBusy(true); setMessage('');
    try {
      const images = await uploadOurWorkImages(files);
      await api('/our-work/feedback', { method: 'POST', body: { customerName: form.name, rating: Number(form.rating), feedback: form.feedback, images } });
      setForm({ name: '', rating: '', feedback: '' }); setFiles([]); setFeedbackOpen(false); setMessage('Feedback submit ho gaya. Approval ke baad Hamara Kaam me dikhega.');
    } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Feedback submit nahi hua.'); }
    finally { setBusy(false); }
  };

  const whatsapp = config?.whatsappNumber ? (item: WorkItem) => whatsappEnquiryUrl({ number: config.whatsappNumber, productName: item.title || 'Our Work blouse', url: window.location.href }) : null;

  return <div className="mx-auto max-w-7xl px-3 pb-12 pt-5 sm:px-5">
    <header className="mb-6 flex flex-col gap-4 border-b border-maroon-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-maroon-600">Hamara Kaam</p><h1 className="mt-1 font-display text-3xl font-bold text-ink sm:text-4xl">Our Work</h1><p className="mt-2 max-w-xl text-sm text-ink-muted">Real blouse work, carefully stitched and shared with permission.</p></div>
      <button type="button" className="btn-primary" onClick={() => { setFeedbackOpen(true); setMessage(''); }}><Upload size={17} />Apna Feedback Share Karein</button>
    </header>
    {message && !feedbackOpen ? <p className="mb-4 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{message}</p> : null}
    {items.length === 0 ? <div className="card p-10 text-center text-ink-muted">Abhi gallery update ho rahi hai. Aap apna feedback share kar sakte hain.</div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
      {items.map((item) => {
        const customerList = names(item.customerName);
        const review = messages(item.feedback)[0];
        return <article key={item._id} className="group overflow-hidden rounded-2xl border border-maroon-100 bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
          <button type="button" className="block w-full text-left" onClick={() => { setSelected(item); setSlide(0); }}>
            <div className="relative overflow-hidden bg-cream"><img src={item.images[0]?.url} alt={item.title || 'Guddi Silai blouse work'} className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />{item.images.length > 1 ? <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-ink/75 px-2 py-1 text-[10px] font-bold text-white"><ImageIcon size={11} />{item.images.length}</span> : null}</div>
            <div className="p-3 sm:p-4">
              <h2 className="truncate font-display text-sm font-bold text-ink sm:text-base">{item.title || 'Blouse Work'}</h2>
              {customerList.length ? <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold leading-4 text-maroon-700 sm:text-xs"><UserRound size={13} className="mt-0.5 shrink-0" />{customerList.join(' · ')}</p> : <p className="mt-2 text-[11px] text-ink-muted">Customer shared work</p>}
              {item.rating ? <div className="mt-2"><Rating value={item.rating} compact /></div> : null}
              {review ? <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-ink-muted sm:text-xs"><Quote size={12} className="mr-1 inline text-marigold-600" />{review}</p> : null}
              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-maroon-600">Tap for full details</p>
            </div>
          </button>
        </article>;
      })}
    </div>}

    {selected ? <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-3" role="dialog" aria-modal="true"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-maroon-600">Customer story</p><h2 className="mt-1 font-display text-2xl font-bold">{selected.title || 'Blouse Work'}</h2></div><button type="button" className="btn-ghost shrink-0" aria-label="Close" onClick={() => setSelected(null)}><X size={20} /></button></div><div className="relative mt-4"><img src={selected.images[slide]?.url} alt={selected.title || 'Blouse work'} className="max-h-[55vh] w-full rounded-xl bg-cream object-contain" />{selected.images.length > 1 ? <><button type="button" className="absolute left-2 top-1/2 rounded-full bg-white p-2 shadow" aria-label="Previous image" onClick={() => setSlide((slide + selected.images.length - 1) % selected.images.length)}><ChevronLeft size={18} /></button><button type="button" className="absolute right-2 top-1/2 rounded-full bg-white p-2 shadow" aria-label="Next image" onClick={() => setSlide((slide + 1) % selected.images.length)}><ChevronRight size={18} /></button></> : null}</div><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-cream p-3">{selected.customerName ? <p className="flex items-center gap-1.5 text-sm font-bold text-maroon-700"><UserRound size={16} />{names(selected.customerName).join(' · ')}</p> : null}<Rating value={selected.rating} /></div>{selected.description ? <p className="mt-4 text-sm leading-6 text-ink-muted">{selected.description}</p> : null}{selected.feedback ? <div className="mt-4 rounded-xl border border-maroon-100 bg-white p-4"><p className="mb-3 text-xs font-bold uppercase tracking-wide text-maroon-600">Customer message</p><div className="space-y-3">{messages(selected.feedback).map((message, index) => <blockquote key={`${message}-${index}`} className="border-l-4 border-marigold-500 pl-3 text-sm leading-6 text-ink"><Quote size={14} className="mr-1 inline text-marigold-600" />{message}</blockquote>)}</div></div> : null}{selected.source === 'WHATSAPP_MESSAGE' ? <p className="mt-3 text-xs font-semibold text-leaf">Shared through WhatsApp</p> : null}{whatsapp && selected.enquiryEnabled ? <a className="btn-primary mt-5 w-full" href={whatsapp(selected)} target="_blank" rel="noreferrer"><MessageCircle size={17} />{selected.enquiryLabel || 'Enquire Now'}</a> : null}</div></div> : null}

    {feedbackOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-3"><div className="w-full max-w-lg rounded-2xl bg-white p-5"><div className="flex items-start justify-between"><div><h2 className="font-display text-2xl font-bold">Apna Feedback Share Karein</h2><p className="mt-1 text-sm text-ink-muted">Admin approval ke baad publish hoga.</p></div><button type="button" className="btn-ghost" onClick={() => setFeedbackOpen(false)}><X size={20} /></button></div><div className="mt-5 space-y-4"><input className="field" placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><select className="field" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}><option value="">Rating select karein</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}/10</option>)}</select><textarea className="field min-h-28" placeholder="Aapka feedback" value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} /><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-maroon-200 p-3 text-sm font-semibold"><Upload size={17} />{files.length ? `${files.length} image(s) selected` : 'Multiple blouse images upload karein'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>{message ? <p className="text-sm font-semibold text-alert">{message}</p> : null}<button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting...' : 'Submit Feedback'}</button></div></div></div> : null}
  </div>;
}
