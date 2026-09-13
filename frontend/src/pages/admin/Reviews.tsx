import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnPrimary, Empty, Toolbar } from './shared';
import { Check, X, Star } from 'lucide-react';
import { cloudinarySrc } from '../../lib/image';

interface Review {
  _id: string; name: string; rating: number; text: string; photos: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; verifiedPurchase: boolean; createdAt: string;
  product?: { designId: string; name: string };
}

export function ReviewsModule() {
  const [items, setItems] = useState<Review[]>([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async (status: string) => {
    setError('');
    try {
      const res = await api<{ items: Review[] }>(`/admin/reviews?status=${status}`);
      setItems(res.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Reviews load nahi hue.'); }
  };
  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  const moderate = (id: string, status: 'APPROVED' | 'REJECTED') => {
    void setBusy(id);
    void api(`/admin/reviews/${id}/status`, { method: 'PATCH', body: { status } })
      .then(() => { setItems((items) => items.filter((i) => i._id !== id)); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Moderation nahi hui.'))
      .finally(() => setBusy(''));
  };

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Reviews" count={items.length} />
      <div className="flex gap-2 px-5 py-3">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`chip ${statusFilter === s ? 'chip-active' : ''}`}>{s}</button>
        ))}
      </div>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {items.length === 0 ? <div className="col-span-full"><Empty message="Is status mein koi review nahi." /></div> :
          items.map((review) => (
            <article className="rounded-xl border border-maroon-100 p-4" key={review._id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong>{review.product?.designId ?? 'Product'}</strong>
                  <p className="text-sm text-ink-muted">{review.name} {review.verifiedPurchase ? <span className="text-leaf">· Verified</span> : null}</p>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <span className="text-marigold-600">{Array.from({ length: review.rating }).map((_, i) => <Star key={i} size={13} className="inline fill-marigold-500 text-marigold-500" />)}</span>
                    <span className="text-xs text-ink-muted">{new Date(review.createdAt).toLocaleDateString('en-IN')}</span>
                  </div>
                </div>
                <Badge label={review.status} />
              </div>
              {review.text ? <p className="mt-3 text-sm text-ink-muted">{review.text}</p> : null}
              {review.photos?.length ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{review.photos.map((p, i) => <img key={i} src={cloudinarySrc(p, 160)} alt="review" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" />)}</div>
              ) : null}
              {review.status === 'PENDING' ? (
                <div className="mt-3 flex gap-2">
                  <BtnPrimary className="flex-1 px-3" disabled={busy === review._id} onClick={() => moderate(review._id, 'APPROVED')}><Check size={15} />Approve</BtnPrimary>
                  <BtnGhost className="flex-1 px-3" disabled={busy === review._id} onClick={() => moderate(review._id, 'REJECTED')}><X size={15} />Reject</BtnGhost>
                </div>
              ) : null}
            </article>
          ))}
      </div>
    </section>
  );
}