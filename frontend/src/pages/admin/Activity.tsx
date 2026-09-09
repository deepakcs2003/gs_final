import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Empty, Toolbar } from './shared';

interface ActivityItem {
  _id: string; action: string; entity: string; entityId: string; summary: string; at: string; adminName?: string; admin?: string;
}

export function ActivityModule() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    void api<{ items: ActivityItem[] }>('/admin/activity')
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Activity load nahi hui.'));
  };
  useEffect(() => { load(); }, []);

  const filtered = items.filter((item) =>
    `${item.action} ${item.entity} ${item.summary} ${item.entityId}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="card overflow-hidden">
      <Toolbar title="Admin activity log" count={filtered.length} searchPlaceholder="Search actions..." query={query} onQuery={setQuery} />
      <p className="hint px-5 pb-2">Har admin action ka pura audit trail — kisne, kya, kab. Yeh koi edit/delete/status-change par apne aap banta hai.</p>
      {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      <div className="divide-y divide-maroon-100">
        {filtered.length === 0 ? <Empty message="Koi activity nahi mili." /> :
          filtered.map((item) => (
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm" key={item._id}>
              <div className="min-w-0">
                <span className="inline-flex rounded bg-maroon-50 px-2 py-1 text-xs font-bold text-maroon-700">{item.action}</span>
                <span className="ml-2 rounded bg-ink-light/10 px-2 py-1 text-xs font-semibold text-ink-muted">{item.entity}</span>
                <span className="ml-3 font-semibold">{item.summary}</span>
                <span className="ml-2 font-mono text-xs text-ink-muted">{item.entityId}</span>
              </div>
              <time className="shrink-0 text-xs text-ink-muted">{new Date(item.at).toLocaleString('en-IN')}</time>
            </div>
          ))}
      </div>
    </section>
  );
}