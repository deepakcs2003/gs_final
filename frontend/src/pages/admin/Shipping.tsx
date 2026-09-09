import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Toolbar, BtnPrimary, BtnOutline, Toggle, Field, Select } from './shared';
import { Truck, PackageCheck, LinkIcon, Zap } from 'lucide-react';
import { SettingsForm, type SettingDef } from './Settings';

const shippingDefs: SettingDef[] = [
  { key: 'shippingFlatInr', label: 'Flat shipping charge (INR)', hint: '1 item ke liye shipping kitna lagega.', type: 'number' },
  { key: 'freeShippingAboveInr', label: 'Free shipping above (INR)', hint: 'Order total isse zyada ho to shipping free.', type: 'number' },
];

interface EnvInfo { shippingFlatInr: number; freeShippingAboveInr: number }

interface ShiprocketStatus {
  mode: 'mock' | 'live';
  mock: boolean;
  configured: boolean;
  connected: boolean;
  lastTestedAt: string;
  credentials: { email: string; passwordSet: boolean };
  settings: {
    env: 'development' | 'production';
    autoCreate: boolean;
    autoAssignAwb: boolean;
    autoPickup: boolean;
    trackingSync: boolean;
    pickupLocation: string;
  };
  webhook: { url: string; lastAt: string | null; count: number };
}

const defaultSettings = {
  env: 'development' as const,
  autoCreate: false,
  autoAssignAwb: false,
  autoPickup: false,
  trackingSync: true,
  pickupLocation: 'Primary',
};

export function ShippingModule() {
  const [envFallback, setEnvFallback] = useState<EnvInfo | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ShiprocketStatus | null>(null);
  const [draft, setDraft] = useState<ShiprocketStatus['settings']>({ ...defaultSettings });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);

  const load = () => {
    void api<ShiprocketStatus>('/admin/shipping/shiprocket/status')
      .then((res) => {
        setStatus(res);
        setDraft(res.settings);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Shiprocket status load nahi hua.'));
  };

  useEffect(() => {
    void api<{ config: { business: EnvInfo } }>('/config')
      .then((res) => setEnvFallback(res.config.business))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Config load nahi hua.'));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setTestMsg('');
    try {
      const res = await api<{ settings: ShiprocketStatus['settings'] }>('/admin/shipping/shiprocket/settings', {
        method: 'PATCH',
        body: draft,
      });
      setDraft(res.settings);
      setStatus((s) => (s ? { ...s, settings: res.settings } : s));
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : 'Settings save nahi hue.');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestMsg('');
    try {
      const res = await api<{ success: boolean; connected: boolean; message: string; mode: string }>(
        '/admin/shipping/shiprocket/test-connection',
        { method: 'POST' },
      );
      setTestMsg(res.message);
      load();
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : 'Test fail hua.');
    } finally {
      setTesting(false);
    }
  };

  const testWebhook = async () => {
    setWebhookTesting(true);
    try {
      await api('/admin/shipping/shiprocket/test-webhook', { method: 'POST' });
      load();
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : 'Webhook test fail hua.');
    } finally {
      setWebhookTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <Toolbar title="Shipping & delivery" count={shippingDefs.length} />
        <p className="hint px-5 pb-2">Ye values seedha storefront par lagti hain — save karte hi checkout mein changes dikhenge.</p>
        {error ? <div className="m-4 rounded-xl border border-alert/30 bg-alert/10 p-4 text-sm font-semibold text-alert">{error}</div> : null}
        <SettingsForm definitions={shippingDefs} />
        {envFallback ? <div className="px-4 pb-4 text-xs text-ink-muted">Server default (branch par koi DB value nahi to ye use hoti hai): flat ₹{envFallback.shippingFlatInr} / free above ₹{envFallback.freeShippingAboveInr}</div> : null}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-maroon-100 p-5">
          <h3 className="section-title"><Truck size={16} className="inline text-maroon-600" /> Shiprocket integration</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={`rounded-full px-2.5 py-1 ${status?.mode === 'mock' ? 'bg-marigold-100 text-ink' : 'bg-leaf/15 text-leaf'}`}>
              {status?.mode === 'mock' ? 'MOCK MODE — live pincode AWB pickup disabled' : 'LIVE'}
            </span>
            <span className={`rounded-full px-2.5 py-1 ${status?.connected ? 'bg-leaf/15 text-leaf' : 'bg-alert/10 text-alert'}`}>
              {status?.connected ? `Connected${status?.lastTestedAt ? ` (${new Date(status.lastTestedAt).toLocaleString()})` : ''}` : 'Not connected'}
            </span>
            <span className="rounded-full bg-maroon-50 px-2.5 py-1 text-maroon-700">{status?.mock ? 'Mock' : 'Real'} courier API</span>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* Credentials — masked; real values live only in backend .env */}
          <Field label="API credentials (backend .env se)" hint="Yahan koi secret store/hide nahi hota. Email/password sirf backend .env mein hote hain.">
            <div className="mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-ink-light/30 px-3 py-2 text-sm">
              <span className="font-mono text-ink">{status?.credentials.email || 'email not set'}</span>
              <span className="text-ink-muted">/</span>
              <span className="font-mono text-ink">{status?.credentials.passwordSet ? '••••••••' : 'password not set'}</span>
            </div>
          </Field>

          <div className="rounded-xl border border-ink-light/30 p-4">
            <p className="mb-2 text-sm font-bold text-ink">Connection</p>
            <BtnPrimary type="button" onClick={testConnection} disabled={testing}>
              <Zap size={16} /> {testing ? 'Testing...' : 'Test Connection'}
            </BtnPrimary>
            {testMsg ? <p className="mt-2 text-xs font-medium text-ink-muted">{testMsg}</p> : null}
          </div>

          {/* Settings */}
          <div className="rounded-xl border border-ink-light/30 p-4">
            <p className="mb-3 text-sm font-bold text-ink">Automation settings</p>
            <div className="space-y-3">
              <Field label="Environment" hint="Development/manual = controls ko off rakhta hai; production = real Shiprocket">
                <Select value={draft.env} onChange={(e) => setDraft({ ...draft, env: e.target.value as 'development' | 'production' })}>
                  <option value="development">Development</option>
                  <option value="production">Production</option>
                </Select>
              </Field>
              <Toggle label="Auto shipment creation (paid/COD orders)" checked={draft.autoCreate} onChange={(v) => setDraft({ ...draft, autoCreate: v })} />
              <Toggle label="Auto courier assignment (recommended courier)" checked={draft.autoAssignAwb} onChange={(v) => setDraft({ ...draft, autoAssignAwb: v })} />
              <Toggle label="Auto pickup scheduling" checked={draft.autoPickup} onChange={(v) => setDraft({ ...draft, autoPickup: v })} />
              <Toggle label="Tracking sync (webhook + manual sync)" checked={draft.trackingSync} onChange={(v) => setDraft({ ...draft, trackingSync: v })} />
              <Field label="Pickup location" hint="Shiprocket account mein saved pickup location ka naam.">
                <Select value={draft.pickupLocation} onChange={(e) => setDraft({ ...draft, pickupLocation: e.target.value })}>
                  <option value="Primary">Primary</option>
                  <option value="Secondary">Secondary</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <BtnPrimary type="button" disabled={saving} onClick={() => void saveSettings()}>
                {saving ? 'Saving...' : 'Save settings'}
              </BtnPrimary>
            </div>
            <p className="mt-2 text-xs text-ink-muted">Auto shipment: paid/COD order par automatically Shiprocket order banega. Abhi default OFF hai — real flow test hone tak ON na karein.</p>
          </div>

          {/* Webhook */}
          <div className="rounded-xl border border-ink-light/30 p-4">
            <p className="mb-2 text-sm font-bold text-ink">Webhook (tracking updates)</p>
            <p className="text-xs text-ink-muted">Shiprocket panel mein is URL ko webhook par laga dein.</p>
            <code className="mt-2 block break-all rounded-lg bg-ink/5 px-3 py-2 font-mono text-xs text-ink">{status?.webhook.url ?? '...'}</code>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
              <span className={`inline-flex items-center gap-1.5 ${status?.webhook.lastAt ? 'bg-leaf/15 px-2 py-1 rounded-full text-leaf' : 'bg-ink-light/20 px-2 py-1 rounded-full text-ink-muted'}`}>
                <LinkIcon size={13} /> {status?.webhook.lastAt ? `Last update ${new Date(status.webhook.lastAt).toLocaleString()}` : 'Webhook update abhi nahi aayi'}
              </span>
              <span className="text-ink-muted">received {status?.webhook.count ?? 0} events</span>
              <BtnOutline type="button" disabled={webhookTesting} onClick={() => void testWebhook()}>
                {webhookTesting ? 'Testing...' : 'Test webhook'}
              </BtnOutline>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="section-title"><Truck size={16} className="inline text-maroon-600" /> Shiprocket order controls</h3>
          <p className="hint mt-1">Orders → order detail: Create Shipment, Assign AWB, Schedule Pickup, Label, Sync, Cancel. Har step ke baad status update hota hai aur customer ko tracking milegi.</p>
        </section>
        <section className="card p-5">
          <h3 className="section-title"><PackageCheck size={16} className="inline text-maroon-600" /> Handling & stitching timeline</h3>
          <p className="hint mt-1">Processing days aur stitching timeline har product par set hota hai (Products → customize options). Timing kab deliver hoga yahi decide karta hai.</p>
        </section>
      </div>
    </div>
  );
}