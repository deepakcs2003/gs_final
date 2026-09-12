import { useEffect, useState } from 'react';
import { Send, Trash2, RefreshCw, CheckCircle2, XCircle, Users, AlertTriangle, Search, Sparkles } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Badge, BtnGhost, BtnOutline, BtnPrimary, Checkbox, Empty, Field, Modal, Select, TextArea, TextInput, Toggle } from './shared';

/* -------------------------------------------------------------------------- */
/* Types (mirror the backend routes)                                           */
/* -------------------------------------------------------------------------- */

interface WaSettings {
  enabled: boolean;
  mode: 'test' | 'production';
  notifyConfirmed: boolean;
  notifyShipped: boolean;
  notifyOutForDelivery: boolean;
  notifyDelivered: boolean;
  notifyCancelled: boolean;
  marketingCooldownDays: number;
  costPerMessageInr: number;
  dailyQuota: number;
  addOrderLink: boolean;
}

interface OverviewData {
  integration: {
    configured: boolean;
    mode: string;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    verifyTokenSet: boolean;
    appSecretSet: boolean;
    testNumbers: string[];
  };
  webhookUrl: string;
  counts: {
    createdToday: number; sentToday: number; deliveredToday: number; failedToday: number;
    pending: number; delivered: number; activeCampaigns: number;
  };
  webhookLastAt: string | null;
  settings: WaSettings;
}

interface WaTemplate { name: string; category: string; language: string; body: string; needsButton: boolean; buttonText: string; purpose: string; }

interface WaCampaign {
  _id: string; name: string; message: string; templateName: string; language: string;
  targetSource: 'WEBSITE_USERS' | 'ORDER_USERS' | 'MANUAL_NUMBERS';
  manualNumbers: string[];
  segment: { hasOrders: boolean; minSpendMinor: number; purchasedProductIds: string[] };
  perMessageCostInr: number; status: string; recipientCount: number; estimatedCostInr: number;
  sentCount: number; deliveredCount: number; failedCount: number; createdAt: string;
}

interface WaMessage {
  _id: string; mobile: string; customerId: string | null; orderId: string | null; campaignId: string | null;
  type: string; category: string; templateName: string; dedupeKey: string;
  metaMessageId: string; status: string; failureReason: string;
  createdAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null;
}

interface ProductLite { _id: string; name: string; }

const msgTones: Record<string, string> = {
  PENDING: 'bg-marigold-100 text-ink',
  SENT: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-leaf/15 text-leaf',
  READ: 'bg-purple-100 text-purple-700',
  FAILED: 'bg-alert/10 text-alert',
  SKIPPED: 'bg-ink-light/10 text-ink-muted',
};

const campaignTones: Record<string, string> = {
  DRAFT: 'bg-maroon-50 text-maroon-700',
  QUEUED: 'bg-marigold-100 text-ink',
  SENDING: 'bg-marigold-100 text-ink',
  DONE: 'bg-leaf/15 text-leaf',
  PARTIAL: 'bg-alert/10 text-alert',
  CANCELLED: 'bg-ink-light/10 text-ink-muted',
};

function money(x: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(x);
}

function at(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString('en-IN') : '—';
}

/* -------------------------------------------------------------------------- */
/* Module shell with 6 tabs                                                    */
/* -------------------------------------------------------------------------- */

const tabs: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'templates', label: 'Templates' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'automations', label: 'Automations' },
  { key: 'messages', label: 'Message Logs' },
  { key: 'settings', label: 'Settings' },
];

export function CommunicationsModule() {
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`chip whitespace-nowrap ${tab === t.key ? 'chip-active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error ? <div className="rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
      {tab === 'overview' ? <OverviewTab onError={setError} /> : null}
      {tab === 'templates' ? <TemplatesTab onError={setError} /> : null}
      {tab === 'campaigns' ? <CampaignsTab onError={setError} /> : null}
      {tab === 'automations' ? <AutomationsTab onError={setError} /> : null}
      {tab === 'messages' ? <MessagesTab onError={setError} /> : null}
      {tab === 'settings' ? <SettingsTab onError={setError} /> : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewTab({ onError }: { onError: (msg: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void api<OverviewData>('/admin/communications/overview')
      .then((res) => setData(res))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Overview load nahi hui.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading && !data) return <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>;
  if (!data) return null;

  const { integration, counts, webhookUrl, settings } = data;
  const cards = [
    { label: 'Aaj ke messages', value: counts.createdToday, tone: 'text-maroon-700' },
    { label: 'Sent (aaj)', value: counts.sentToday, tone: 'text-blue-700' },
    { label: 'Delivered (aaj)', value: counts.deliveredToday, tone: 'text-leaf' },
    { label: 'Pending queue', value: counts.pending, tone: 'text-ink' },
    { label: 'Delivered (total)', value: counts.delivered, tone: 'text-leaf' },
    { label: 'Failures (aaj)', value: counts.failedToday, tone: 'text-alert' },
    { label: 'Active campaigns', value: counts.activeCampaigns, tone: 'text-marigold-700' },
  ];

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${integration.configured ? '' : 'opacity-90'}`}>
        {cards.map((c) => (
          <div className="card p-5" key={c.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{c.label}</p>
            <p className={`mt-2 font-display text-3xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-lg font-bold">WhatsApp integration</h4>
            <p className="hint mt-1">MSG91 hata diya gaya — saare messages ab approved WhatsApp templates se jaate hain.</p>
          </div>
          <Badge label={integration.configured ? 'CONFIGURED' : 'NOT CONFIGURED'} tone={integration.configured ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'} />
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-maroon-50/60 p-3"><p className="text-xs font-semibold text-ink-muted">Mode</p><p className="mt-1 font-mono font-semibold uppercase">{integration.mode}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3"><p className="text-xs font-semibold text-ink-muted">Phone number ID</p><p className="mt-1 font-mono font-semibold">{integration.phoneNumberId ?? '—'}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3 sm:col-span-2"><p className="text-xs font-semibold text-ink-muted">Webhook URL (Meta mein paste karein)</p>
            <p className="mt-1 break-all font-mono text-xs">{webhookUrl}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3 sm:col-span-2"><p className="text-xs font-semibold text-ink-muted">Test numbers (test mode mein in par hi bhejega)</p>
            <p className="mt-1 font-mono text-sm">{integration.testNumbers.length ? integration.testNumbers.join(', ') : 'Koi nahi — ADMIN_MOBILE set karein.'}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3"><p className="text-xs font-semibold text-ink-muted">Verify token set</p><p className="mt-1 font-semibold">{integration.verifyTokenSet ? 'Ha' : 'Nahi'}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3"><p className="text-xs font-semibold text-ink-muted">App secret set</p><p className="mt-1 font-semibold">{integration.appSecretSet ? 'Ha' : 'Nahi'}</p></div>
          <div className="rounded-xl bg-maroon-50/60 p-3"><p className="text-xs font-semibold text-ink-muted">Last webhook received</p><p className="mt-1 font-semibold">{at(data.webhookLastAt)}</p></div>
        </div>
        {!settings.enabled ? <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-alert"><AlertTriangle size={15} /> WhatsApp abhi off hai — Settings tab se ON karein.</p> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

function TemplatesTab({ onError }: { onError: (msg: string) => void }) {
  const [list, setList] = useState<WaTemplate[]>([]);
  const [meta, setMeta] = useState<{ webhookUrl: string; mode: string; configured: boolean } | null>(null);

  useEffect(() => {
    void api<{ templates: WaTemplate[]; webhookUrl: string; mode: string; configured: boolean }>('/admin/communications/templates')
      .then((res) => { setList(res.templates); setMeta({ webhookUrl: res.webhookUrl, mode: res.mode, configured: res.configured }); })
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Templates load nahi hue.'));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const catTone: Record<string, string> = {
    AUTHENTICATION: 'bg-purple-100 text-purple-700',
    UTILITY: 'bg-blue-100 text-blue-700',
    MARKETING: 'bg-marigold-100 text-ink',
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-maroon-100 p-5">
        <h4 className="font-display text-lg font-bold">Template registry</h4>
        <p className="hint mt-1">
          Yeh 7 templates Meta Business Manager mein create + approve karne padte hain — ek baar approve ho jayein to saare messages inn hi se bheje jaate hain. Body exactly match karein (variable positions {`{{n}}`} wahi hain).
        </p>
        {meta && !meta.configured ? <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-alert"><XCircle size={15} /> Integration configured nahi hai — .env mein WhatsApp keys laga kar server restart karein.</p> : null}
      </div>
      <div className="divide-y divide-maroon-100">
        {list.length === 0 ? <Empty message="Koi template nahi mila." /> : list.map((t) => (
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" key={t.name}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold">{t.name}</span>
                <Badge label={t.category} tone={catTone[t.category]} />
                <span className="rounded-full bg-ink-light/10 px-2 py-1 text-[11px] font-semibold text-ink-muted">{t.language}</span>
                {t.needsButton ? <span className="rounded-full bg-maroon-50 px-2 py-1 text-[11px] font-semibold text-maroon-700">URL button: {t.buttonText}</span> : null}
              </div>
              <p className="mt-2 rounded-xl bg-cream/70 p-3 font-mono text-xs leading-5 text-ink">{t.body}</p>
              <p className="mt-2 text-xs text-ink-muted">{t.purpose}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                   */
/* -------------------------------------------------------------------------- */

const emptyCampaign = {
  name: '', message: '', templateName: 'guddi_offer', language: 'en_US',
  targetSource: 'WEBSITE_USERS' as WaCampaign['targetSource'],
  manualNumbers: [] as string[],
  segment: { hasOrders: false, minSpendMinor: 0, purchasedProductIds: [] as string[] },
  perMessageCostInr: 0.9,
};

const TARGET_LABEL: Record<WaCampaign['targetSource'], string> = {
  WEBSITE_USERS: 'Website users (registered + WhatsApp opt-in)',
  ORDER_USERS: 'Order customers (opt-in + segment filters)',
  MANUAL_NUMBERS: 'Manual number list (admin ka khud ka list)',
};

function CampaignsTab({ onError }: { onError: (msg: string) => void }) {
  const [list, setList] = useState<WaCampaign[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WaCampaign | null>(null);
  const [previewing, setPreviewing] = useState<WaCampaign | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [form, setForm] = useState({ ...emptyCampaign });
  const [numbersText, setNumbersText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<{ recipientCount: number; estimatedCostInr: number; cooldownDays: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const load = () => {
    void api<{ items: WaCampaign[] }>('/admin/communications/campaigns')
      .then((res) => setList(res.items))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Campaigns load nahi hue.'));
  };
  useEffect(() => { load(); void api<{ items: ProductLite[] }>('/admin/products').then((r) => setProducts(r.items)).catch(() => setProducts([])); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setSegment = (patch: Partial<typeof form.segment>) => setForm((f) => ({ ...f, segment: { ...f.segment, ...patch } }));
  const setTarget = (targetSource: WaCampaign['targetSource']) => set({ targetSource });

  const openCreate = () => { setForm({ ...emptyCampaign }); setNumbersText(''); setMsg(''); setCreating(true); };
  const openEdit = (c: WaCampaign) => {
    setForm({ name: c.name, message: c.message, templateName: c.templateName, language: c.language, targetSource: c.targetSource, manualNumbers: c.manualNumbers ?? [], segment: c.segment, perMessageCostInr: c.perMessageCostInr });
    setNumbersText((c.manualNumbers ?? []).join(', '));
    setEditing(c); setMsg('');
  };

  const save = () => {
    if (!form.name.trim() || !form.message.trim()) { setMsg('Naam aur message dono bharo.'); return; }
    if (form.targetSource === 'MANUAL_NUMBERS') {
      const numbers = numbersText.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);
      if (numbers.length === 0) { setMsg('MANUAL_NUMBERS target par kam se kam ek number likho.'); return; }
      if (numbers.length > 500) { setMsg('Max 500 numbers allowed.'); return; }
    }
    setBusy(true); setMsg('');
    const body = {
      ...form,
      manualNumbers: form.targetSource === 'MANUAL_NUMBERS' ? numbersText.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean) : [],
      segment: { ...form.segment, minSpendMinor: Math.round(form.segment.minSpendMinor * 100) },
    };
    const call = editing
      ? api(`/admin/communications/campaigns/${editing._id}`, { method: 'PATCH', body })
      : api('/admin/communications/campaigns', { method: 'POST', body });
    void call
      .then(() => { setCreating(false); setEditing(null); load(); })
      .catch((err) => setMsg(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(false));
  };

  const runPreview = (c: WaCampaign) => {
    setPreviewing(c); setPreview(null); setConfirmed(false);
    void api<{ recipientCount: number; estimatedCostInr: number; cooldownDays: number }>(`/admin/communications/campaigns/${c._id}/preview`, { method: 'POST', body: {} })
      .then((r) => setPreview(r))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Preview nahi mili.'));
  };

  const send = () => {
    if (!previewing || !confirmed) return;
    setBusy(true);
    void api<{ queued: number; skipped: number; recipients: number; estCostInr: number }>(`/admin/communications/campaigns/${previewing._id}/send`, { method: 'POST', body: { confirm: true } })
      .then(() => { setPreviewing(null); setMsg('Campaign queue mein daal diya gaya hai.'); load(); })
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Send nahi hua.'))
      .finally(() => setBusy(false));
  };

  const remove = (c: WaCampaign) => {
    if (!window.confirm(`Campaign '${c.name}' delete karein?`)) return;
    void api(`/admin/communications/campaigns/${c._id}`, { method: 'DELETE' })
      .then(() => load())
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Delete nahi hua.'));
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-maroon-100 p-5">
        <div>
          <h4 className="font-display text-lg font-bold">Marketing campaigns <span className="text-base font-normal text-ink-muted">({list.length})</span></h4>
          <p className="hint mt-1">Sirf opt-in customer ko, har 7 din mein ek baar. Pehle preview dekhoge, phir confirm se send hoga — kabhi accidental blast nahi.</p>
        </div>
        <BtnPrimary onClick={openCreate}><Send size={15} />Naya campaign</BtnPrimary>
      </div>
      {msg ? <p className="mx-5 mt-3 text-sm font-semibold text-leaf">{msg}</p> : null}
      <div className="divide-y divide-maroon-100">
        {list.length === 0 ? <Empty message="Abhi koi campaign nahi." /> : list.map((c) => (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" key={c._id}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{c.name}</p>
                <Badge label={c.status} tone={campaignTones[c.status]} />
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{c.message}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {c.recipientCount > 0 ? `${c.recipientCount} recipients · est. ${money(c.estimatedCostInr)}` : 'Recipients abhi 0 — send karne se pehle preview dekho'} · {at(c.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {c.status === 'DRAFT' ? <BtnGhost onClick={() => openEdit(c)}><RefreshCw size={14} />Edit</BtnGhost> : null}
              <BtnOutline onClick={() => runPreview(c)}><Users size={14} />Preview & send</BtnOutline>
              {c.status === 'DRAFT' ? <BtnGhost onClick={() => remove(c)} className="!text-alert"><Trash2 size={14} /></BtnGhost> : null}
            </div>
          </div>
        ))}
      </div>

      <Modal open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} title={editing ? 'Campaign edit karein' : 'Naya campaign'} subtitle="MARKETING template (guddi_offer) se customer tak">
        <div className="space-y-4">
          <Field label="Campaign naav">
            <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Navratri offer" maxLength={80} />
          </Field>
          <Field label="Message" hint="{{1}} ke jagah yeh baat customer tak jaayegi. Short + sweet rakho.">
            <TextArea value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="Aapka pyaara message..." maxLength={1000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template">
              <Select value={form.templateName} onChange={(e) => set({ templateName: e.target.value })}>
                <option value="guddi_offer">guddi_offer (marketing)</option>
              </Select>
            </Field>
            <Field label="Cost per message (₹)">
              <TextInput type="number" step="0.1" min={0} value={form.perMessageCostInr} onChange={(e) => set({ perMessageCostInr: Number(e.target.value) })} />
            </Field>
          </div>

          <div className="rounded-xl border border-ink-light/20 p-4">
            <p className="text-sm font-bold text-ink">Audience — kis number par bhejna hai</p>
            <div className="mt-3 space-y-3">
              <Field label="Target" hint="Chuno: website ke users, order karne wale users, ya apna manual number list">
                <Select value={form.targetSource} onChange={(e) => setTarget(e.target.value as WaCampaign['targetSource'])}>
                  <option value="WEBSITE_USERS">{TARGET_LABEL.WEBSITE_USERS}</option>
                  <option value="ORDER_USERS">{TARGET_LABEL.ORDER_USERS}</option>
                  <option value="MANUAL_NUMBERS">{TARGET_LABEL.MANUAL_NUMBERS}</option>
                </Select>
              </Field>

              {form.targetSource === 'ORDER_USERS' ? (
                <>
                  <Checkbox label="Sirf valid orders (cancel nahi huye)" checked={form.segment.hasOrders} onChange={(v) => setSegment({ hasOrders: v })} hint="Cancelled orders wale customers ko na bhejne ke liye ON rakho" />
                  <Field label="Minimum spend (₹)" hint="Lifetime spend isse zyada ho tab hi message jaaye">
                    <TextInput type="number" min={0} value={form.segment.minSpendMinor} onChange={(e) => setSegment({ minSpendMinor: Number(e.target.value) })} />
                  </Field>
                  <Field label="Khaas products se khareeda (optional)" hint="Un customers ko bhejo jinhone yeh products khareede — select optional hai">
                    <Select value={form.segment.purchasedProductIds[0] ?? ''} onChange={(e) => setSegment({ purchasedProductIds: e.target.value ? [e.target.value] : [] })}>
                      <option value="">Koi bhi product (sab customers)</option>
                      {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </Select>
                  </Field>
                </>
              ) : null}

              {form.targetSource === 'MANUAL_NUMBERS' ? (
                <Field label="Numbers list" hint="Comma ya newline se alag karo, e.g. 917709894512, 919876543210. Bina opt-in ke seedha in number par hi jaayega.">
                  <TextArea rows={5} value={numbersText} onChange={(e) => setNumbersText(e.target.value)} placeholder="917709894512, 919876543210" className="font-mono" />
                </Field>
              ) : null}
            </div>
          </div>
          {msg ? <p className="text-sm font-semibold text-alert">{msg}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <BtnOutline onClick={() => { setCreating(false); setEditing(null); }}>Cancel</BtnOutline>
          <BtnPrimary onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save campaign'}</BtnPrimary>
        </div>
      </Modal>

      <Modal open={!!previewing} onClose={() => setPreviewing(null)} title={previewing?.name ?? ''} subtitle="Send karne se pehle — costing review">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-maroon-50/60 p-4 text-center">
              <p className="text-xs font-semibold text-ink-muted">Recipients</p>
              <p className="mt-1 font-display text-2xl font-bold text-maroon-700">{preview ? preview.recipientCount : '...'}</p>
            </div>
            <div className="rounded-xl bg-maroon-50/60 p-4 text-center">
              <p className="text-xs font-semibold text-ink-muted">Estimated cost</p>
              <p className="mt-1 font-display text-2xl font-bold text-maroon-700">{preview ? money(preview.estimatedCostInr) : '...'}</p>
            </div>
            <div className="rounded-xl bg-maroon-50/60 p-4 text-center">
              <p className="text-xs font-semibold text-ink-muted">Cooldown</p>
              <p className="mt-1 font-display text-2xl font-bold text-maroon-700">{preview ? `${preview.cooldownDays} din` : '...'}</p>
            </div>
          </div>
          {preview ? (
            <>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-alert/30 bg-alert/10 p-4">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-maroon-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="text-sm font-semibold text-ink">Mujhe pata hai yeh {money(preview.estimatedCostInr)} tak lag sakta hai aur apne {preview.recipientCount} customers ko bhejunga — ab send karna hai.</span>
              </label>
              <BtnPrimary onClick={send} disabled={!confirmed || busy} className="w-full">{busy ? 'Queue mein ja raha hai...' : 'Ha, send karo'}</BtnPrimary>
            </>
          ) : <p className="text-center text-sm text-ink-muted">Preview load ho rahi hai...</p>}
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Automations — order-event toggles                                           */
/* -------------------------------------------------------------------------- */

function AutomationsTab({ onError }: { onError: (msg: string) => void }) {
  const [s, setS] = useState<WaSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ settings: WaSettings }>('/admin/communications/settings')
      .then((r) => setS(r.settings))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Settings load nahi hue.'));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const update = (patch: Partial<WaSettings>) => {
    if (!s) return;
    setBusy(true);
    void api<{ settings: WaSettings }>('/admin/communications/settings', { method: 'PUT', body: patch })
      .then((r) => setS(r.settings))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(false));
  };

  if (!s) return <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>;

  const rows: Array<{ key: keyof WaSettings; label: string; hint: string }> = [
    { key: 'notifyConfirmed', label: 'Order confirm hote hi', hint: 'Order number + payment status + track link — order-placed aur payment captured dono isi ek message mein (2 messages ki jagah 1).' },
    { key: 'notifyShipped', label: 'Ship hote hi', hint: 'AWB number ke saath short message.' },
    { key: 'notifyOutForDelivery', label: 'Out-for-delivery par', hint: 'Sirf jab parcel mid-flight ho.' },
    { key: 'notifyDelivered', label: 'Deliver hote hi', hint: 'Delivery confirmation.' },
    { key: 'notifyCancelled', label: 'Cancel + refund', hint: 'Refund amount variable se jaata hai.' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card p-5">
        <h4 className="font-display text-lg font-bold">Order automations</h4>
        <p className="hint mt-1">Har event ka apna switch. Spec ka minimum set hi ON hai — taaki cost kam, messages only tab jaayein jab customer ko zaroor pohochna chahiye.</p>
        {busy ? <p className="mt-2 text-xs font-semibold text-ink-muted">Saving...</p> : null}
        <div className="mt-4 divide-y divide-maroon-100">
          {rows.map((row) => (
            <div className="flex items-center justify-between gap-4 py-3" key={row.key}>
              <div>
                <p className="text-sm font-semibold text-ink">{row.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{row.hint}</p>
              </div>
              <Toggle label="" checked={Boolean(s[row.key])} onChange={(v) => update({ [row.key]: v } as Partial<WaSettings>)} />
            </div>
          ))}
        </div>
      </div>
      <div className="card p-5">
        <h4 className="font-display text-lg font-bold">Marketing cooldown</h4>
        <p className="hint mt-1">Ek customer ko kitne din mein ek baar marketing message bheja ja sakta hai (default 7 din).</p>
        <div className="mt-3 flex items-center gap-3">
          <input type="range" min={1} max={30} value={s.marketingCooldownDays}
            onChange={(e) => setS({ ...s, marketingCooldownDays: Number(e.target.value) })}
            onMouseUp={() => update({ marketingCooldownDays: s.marketingCooldownDays })}
            onTouchEnd={() => update({ marketingCooldownDays: s.marketingCooldownDays })}
            className="w-full accent-maroon-600" />
          <span className="w-16 rounded-lg bg-maroon-50 px-2 py-1 text-center font-mono font-bold text-maroon-700">{s.marketingCooldownDays} din</span>
        </div>
        <button className="mt-3 btn-outline min-h-10 px-3 text-sm" onClick={() => update({ marketingCooldownDays: s.marketingCooldownDays })}>Cooldown save karein</button>
      </div>
      <p className="hint px-1">Note: "Production started" aur "Ready to ship" ke messages jaante-huay nahi banaye — unka ROI chhota hota hai aur har message paise ka hai. Chahoge to baad mein add ho sakte hain.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Message logs                                                                */
/* -------------------------------------------------------------------------- */

function MessagesTab({ onError }: { onError: (msg: string) => void }) {
  const [items, setItems] = useState<WaMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const pageSize = 25;

  const load = (p: number, st: string) => {
    const params = new URLSearchParams({ page: String(p) });
    if (st) params.set('status', st);
    void api<{ items: WaMessage[]; total: number; hasMore: boolean }>(`/admin/communications/messages?${params.toString()}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Messages load nahi hue.'));
  };
  useEffect(() => { load(page, status); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, status]);

  const filtered = query ? items.filter((m) => `${m.mobile} ${m.type} ${m.templateName} ${m.status} ${m.dedupeKey}`.toLowerCase().includes(query.toLowerCase())) : items;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-maroon-100 p-5">
        <div>
          <h4 className="font-display text-lg font-bold">Message logs <span className="text-base font-normal text-ink-muted">({total})</span></h4>
          <p className="hint mt-1">Har WhatsApp message ki Meta status — sent, delivered, read, failed. Webhook se update hoti hai.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field min-h-[42px] py-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Sab status</option>
            {['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="relative block">
            <Search className="absolute left-2.5 top-3 text-ink-light" size={15} />
            <input className="field min-h-[42px] pl-9 py-2 text-sm" placeholder="Filter..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-maroon-100 text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-5 py-3 font-semibold">Mobile</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold">Template</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Meta id</th>
              <th className="px-5 py-3 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maroon-100">
            {filtered.length === 0 ? <tr><td colSpan={6}><Empty message="Koi message nahi mila." /></td></tr> :
              filtered.map((m) => (
                <tr key={m._id} className="hover:bg-maroon-50/40">
                  <td className="px-5 py-3 font-mono font-semibold">{m.mobile}</td>
                  <td className="px-3 py-3"><Badge label={m.type} /></td>
                  <td className="px-3 py-3 font-mono text-xs">{m.templateName}</td>
                  <td className="px-3 py-3"><Badge label={m.status} tone={msgTones[m.status]} /></td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-muted">{m.metaMessageId || (m.status === 'FAILED' ? <span className="text-alert">{m.failureReason || 'failed'}</span> : '—')}</td>
                  <td className="px-5 py-3 text-xs text-ink-muted">{at(m.createdAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-maroon-100 px-5 py-3 text-sm">
        <p className="text-xs text-ink-muted">Page {page} · {pageSize} per page</p>
        <div className="flex gap-2">
          <BtnGhost disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</BtnGhost>
          <BtnGhost disabled={items.length < pageSize} onClick={() => setPage((p) => p + 1)}>Next</BtnGhost>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings + test send                                                        */
/* -------------------------------------------------------------------------- */

function SettingsTab({ onError }: { onError: (msg: string) => void }) {
  const [s, setS] = useState<WaSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [testMobile, setTestMobile] = useState('');
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    void api<{ settings: WaSettings }>('/admin/communications/settings')
      .then((r) => setS(r.settings))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Settings load nahi hue.'));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const update = (patch: Partial<WaSettings>) => {
    if (!s) return;
    setBusy(true);
    void api<{ settings: WaSettings }>('/admin/communications/settings', { method: 'PUT', body: patch })
      .then((r) => setS(r.settings))
      .catch((err) => onError(err instanceof ApiError ? err.message : 'Save nahi hua.'))
      .finally(() => setBusy(false));
  };

  const sendTest = () => {
    setTestBusy(true); setMsg('');
    void api<{ ok: boolean }>('/admin/communications/test', { method: 'POST', body: { mobile: testMobile || undefined } })
      .then(() => setMsg('Test message queue mein daal diya gaya — 2-3 second mein aayega.'))
      .catch((err) => setMsg(err instanceof ApiError ? err.message : 'Test nahi bheja.'))
      .finally(() => setTestBusy(false));
  };

  if (!s) return <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card p-5">
        <h4 className="font-display text-lg font-bold">WhatsApp settings</h4>
        <p className="hint mt-1">Mode (test/production) yahan se nahi badalta — woh .env ka switch hai, jaane-bujhkar. Test mode mein sirf test numbers par jaata hai.</p>
        {busy ? <p className="mt-1 text-xs font-semibold text-ink-muted">Saving...</p> : null}
        <div className="mt-4 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">WhatsApp enabled</p>
              <p className="mt-0.5 text-xs text-ink-muted">Off karne par koi bhi message nahi bheja jaayega — orders, OTP, campaigns, sab.</p>
            </div>
            <Toggle label="" checked={s.enabled} onChange={(v) => update({ enabled: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Average cost per message (₹)" hint="Campaign estimated cost ke liye">
              <TextInput type="number" step="0.1" min={0} value={s.costPerMessageInr} onChange={(e) => update({ costPerMessageInr: Number(e.target.value) })} />
            </Field>
            <Field label="Daily quota (free tier sunny count)" hint="Sirf UI headline ke liye — enforcement nahi">
              <TextInput type="number" min={1} value={s.dailyQuota} onChange={(e) => update({ dailyQuota: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">Order messages mein track link</p>
              <p className="mt-0.5 text-xs text-ink-muted">Website-first strategy — URL button order page ka link kholta hai.</p>
            </div>
            <Toggle label="" checked={s.addOrderLink} onChange={(v) => update({ addOrderLink: v })} />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h4 className="font-display text-lg font-bold">Test send <span className="align-middle"><Sparkles className="inline text-marigold-500" size={16} /></span></h4>
        <p className="hint mt-1">Test mode mein WhatsApp sirf in numbers par jaata hai: <span className="font-mono text-xs font-semibold text-ink">ADMIN_MOBILE</span> + test mode wale numbers. Real kisi ke ghar nahi jaata — jaane-bujhkar.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Mobile (optional)" className="min-w-56 flex-1">
            <TextInput placeholder="10 digit mobile — blank = admin khud ko" value={testMobile} onChange={(e) => setTestMobile(e.target.value)} maxLength={15} />
          </Field>
          <button className="btn-primary min-h-10 px-4 text-sm" onClick={sendTest} disabled={testBusy}>
            {testBusy ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />} Test bhejo
          </button>
        </div>
        {msg ? <p className={`mt-3 text-sm font-semibold ${msg.includes('nahi') ? 'text-alert' : 'text-leaf'}`}>{msg}</p> : null}
      </div>

      <div className="card p-5">
        <h4 className="font-display text-lg font-bold">Setup checklist</h4>
        <ul className="mt-3 space-y-2 text-sm text-ink-muted">
          <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-leaf" size={15} /><span>.env mein TEST/PRODUCTION creds set karo: <code className="rounded bg-maroon-50 px-1 font-mono text-xs">WHATSAPP_TEST_PHONE_NUMBER_ID</code> + <code className="rounded bg-maroon-50 px-1 font-mono text-xs">WHATSAPP_TEST_ACCESS_TOKEN</code> (active set <code className="rounded bg-maroon-50 px-1 font-mono text-xs">WHATSAPP_MODE</code> decide karta hai).</span></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-leaf" size={15} /><span>Meta mein 7 templates create + approve karo (Templates tab mein bodies di hui hain).</span></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-leaf" size={15} /><span>Meta App → Webhook mein URL + <code className="rounded bg-maroon-50 px-1 font-mono text-xs">WHATSAPP_VERIFY_TOKEN</code> verify karo (Overview tab mein URL hai).</span></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-leaf" size={15} /><span>Test message bhejo, status <code className="rounded bg-maroon-50 px-1 font-mono text-xs">DELIVERED</code> dekh lo.</span></li>
          <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-leaf" size={15} /><span>Real kaam shuru: <code className="rounded bg-maroon-50 px-1 font-mono text-xs">WHATSAPP_MODE=production</code> + server restart.</span></li>
        </ul>
      </div>
    </div>
  );
}