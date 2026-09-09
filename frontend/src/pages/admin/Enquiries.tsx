import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, Empty, Toolbar } from './shared';
import { MessageCircle, Phone, FileText, Trash2 } from 'lucide-react';

interface Enquiry {
  _id: string; channel: 'WHATSAPP' | 'CALL' | 'FORM'; message: string; createdAt: string;
  product?: { designId?: string; name?: string } | null;
}

const CHANNELS = ['ALL', 'WHATSAPP', 'CALL', 'FORM'] as const;
const channelMeta: Record<Enquiry['channel'], { icon: typeof MessageCircle; tone: string }> = {
  WHATSAPP: { icon: MessageCircle, tone: 'bg-leaf/15 text-leaf' },
  CALL: { icon: Phone, tone: 'bg-blue-100 text-blue-700' },
  FORM: { icon: FileText, tone: 'bg-marigold-100 text-ink' },
};

export function EnquiriesModule() {
  const [items, setItems] = useState<Enquiry[]>([]);
  const [channel, setChannel] = useState<string>('ALL');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = (ch = channel) => {
    setError('');
    void api<{ items: Enquiry[] }>(`/admin/enquiries${ch === 'ALL' ? '' : `?channel=${ch}`}`)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Enquiries load nahi hui.'));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [channel]);

  const remove = (id: string) => {
    if (!confirm('Yeh enquiry delete karein?')) return;
    void setBusy(id);
    void api(`/admin/enquiries/${id}`, { method: 'DELETE' })
      .then(() => setItems((items) => items.filter((i) => i._id !== id)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Delete nahi hua.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="WhatsApp & enquiries" count={items.length} />
      <div className="flex gap-2 px-5 py-3">
        {CHANNELS.map((ch) => <button key={ch} onClick={() => setChannel(ch)} className={`chip ${channel === ch ? 'chip-active' : ''}`}>{ch}</button>)}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Koi enquiry nahi hai." /></div> :
          items.map((enquiry) => {
            const meta = channelMeta[enquiry.channel] ?? channelMeta.FORM;
            const Icon = meta.icon;
            return (
              <article className="rounded-xl border border-maroon-100 p-4" key={enquiry._id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-8 w-8 place-items-center rounded-full ${meta.tone}`}><Icon size={16} /></span>
                    <Badge label={enquiry.channel} />
                  </div>
                  <time className="text-xs text-ink-muted">{new Date(enquiry.createdAt).toLocaleString('en-IN')}</time>
                </div>
                {enquiry.product ? (
                  <p className="mt-3 text-xs text-ink-muted">Product: <strong className="text-maroon-700">{enquiry.product.designId ?? enquiry.product.name ?? ''}</strong></p>
                ) : null}
                <p className="mt-2 text-sm text-ink">{enquiry.message || '—'}</p>
                <div className="mt-3 flex justify-end">
                  <BtnGhost className="px-3 text-alert" disabled={busy === enquiry._id} onClick={() => remove(enquiry._id)}><Trash2 size={15} />Delete</BtnGhost>
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}