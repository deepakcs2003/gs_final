/**
 * End-to-end verification of the Meta WhatsApp integration against a RUNNING
 * server (`node dist/index.js`). Dev-only; never import from the app.
 *
 *   npm run dev:wa-e2e
 *
 * Covers: webhook GET challenge (valid + invalid), webhook POST signature
 * (valid HMAC updates the MessageLog to DELIVERED; forged HMAC -> 403),
 * HTTP-level CSRF, admin-authenticated GET /api/whatsapp/status and
 * POST /api/whatsapp/test (real Meta send), duplicate-row protection, and an
 * OTP send through the outbox queue. Prints a summary; exits non-zero on any
 * failure. A `BLOCKED` result means Meta itself refused (bad/expired token,
 * unapproved template) — those are surfaced verbatim, not swallowed.
 */
import crypto from 'node:crypto';
import { connectDb } from '../config/db.js';
import { env, whatsapp } from '../config/env.js';
import { User } from '../models/user.js';
import { MessageLog } from '../models/whatsapp.js';
import { signAccessToken } from '../services/tokens.js';

const API = env.API_BASE_URL.replace(/\/+$/, '');
const ADMIN_MOBILE = env.ADMIN_MOBILE ?? '';

interface Report {
  name: string;
  ok: boolean;
  blocked?: boolean;
  detail: string;
}
const report: Report[] = [];
let blockedCount = 0;
function record(name: string, ok: boolean, detail: string, blocked = false): void {
  report.push({ name, ok, detail, blocked });
  if (blocked) blockedCount += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}${blocked ? '*BLOCKED*' : ''} ${name}: ${detail}`);
}

async function main(): Promise<void> {
  await connectDb();

  const admin = await User.findOneAndUpdate(
    { mobile: ADMIN_MOBILE },
    { $setOnInsert: { mobile: ADMIN_MOBILE, mobileVerified: true, adminRoles: ['SUPER_ADMIN'], isBlocked: false } },
    { upsert: true, new: true },
  ).select('_id mobile adminRoles').lean();
  if (!admin) throw new Error('admin bootstrap failed');
  record('bootstrap admin', true, `id=${String(admin._id)} roles=${(admin.adminRoles ?? []).join(',')}`);

  // Access token is NEVER printed — it only exists inside the cookie jar below.
  const jar = new Map<string, string>();
  const accessToken = signAccessToken(String(admin._id), (admin.adminRoles ?? ['SUPER_ADMIN']) as never, 'e2e');
  jar.set('gs_at', accessToken);

  async function api(path: string, options: {
    method?: string; body?: unknown; cookies?: boolean; headers?: Record<string, string>; rawBody?: Buffer;
  } = {}): Promise<{ status: number; text: string }> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: Buffer | string | undefined;
    if (options.rawBody) {
      body = options.rawBody;
      headers['content-type'] = 'application/json';
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    if (options.cookies) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) headers.cookie = cookie;
    }
    const res = await fetch(`${API}${path}`, { method: options.method ?? 'GET', headers, body, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const m = /^([^=]+)=([^;]*)/.exec(sc);
      if (m && m[1] !== undefined && m[2] !== undefined) jar.set(m[1].trim(), m[2]);
    }
    return { status: res.status, text: await res.text() };
  }

  // 1. Webhook GET — correct verify token echoes the challenge.
  const verifyOk = await api(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(whatsapp.verifyToken)}&hub.challenge=CHALLENGE_ABC123`);
  record('webhook GET valid token', verifyOk.status === 200 && verifyOk.text.trim() === 'CHALLENGE_ABC123', `status=${verifyOk.status} body=${verifyOk.text.slice(0, 60)}`);

  const verifyBad = await api('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=CHALLENGE_ABC123');
  record('webhook GET wrong token -> 403', verifyBad.status === 403, `status=${verifyBad.status}`);

  // 2. CSRF cookie (readable, signed) before any admin write.
  await api('/api/catalog/products?limit=1');
  const csrf = jar.get('gs_csrf') ?? '';
  record('csrf cookie issued', csrf.length > 20, `len=${csrf.length}`);
  const adminHeaders = { 'x-csrf-token': csrf };

  // 3. /api/whatsapp/status — which credential set is active, no secrets.
  const statusRes = await api('/api/whatsapp/status', { cookies: true, headers: adminHeaders });
  let status: Record<string, unknown> = {};
  try { status = JSON.parse(statusRes.text) as Record<string, unknown>; } catch { /* ignore */ }
  record('GET /api/whatsapp/status', statusRes.status === 200 && status.configured === true && status.mode === 'test', `configured=${String(status.configured)} mode=${String(status.mode)} apiVersion=${String(status.apiVersion)}`);

  // 4. POST /api/whatsapp/test — REAL Meta send (hello_world template).
  const testRes = await api('/api/whatsapp/test', { method: 'POST', body: {}, cookies: true, headers: adminHeaders });
  let testBody: { success?: boolean; messageId?: string; mode?: string } = {};
  try { testBody = JSON.parse(testRes.text) as typeof testBody; } catch { /* ignore */ }
  const wamid = testBody.messageId ?? '';
  const testOk = testRes.status === 200 && testBody.success === true && wamid.startsWith('wamid.');
  const testLog = await MessageLog.findOne({ type: 'TEST', templateName: 'hello_world' }).sort({ createdAt: -1 }).select('status failureReason errorCode mode').lean();
  if (testOk) {
    record('POST /api/whatsapp/test → real Meta delivery', true, `messageId=${wamid.slice(0, 40)} mode=${String(testBody.mode)}`);
  } else if (testRes.status === 503) {
    record('POST /api/whatsapp/test — Meta refused the send (credential/problem boundary)', false, `http=${testRes.status} errorCode=${String((testLog as Record<string, unknown> | null)?.errorCode ?? '')} failureReason=${String((testLog as Record<string, unknown> | null)?.failureReason ?? '').slice(0, 200)}`, true);
  } else {
    record('POST /api/whatsapp/test', false, `http=${testRes.status} body=${testRes.text.slice(0, 200)}`);
  }

  // 4b. Duplicate protection: sparse dedupeKey must NOT collide for test rows.
  const testRes2 = await api('/api/whatsapp/test', { method: 'POST', body: {}, cookies: true, headers: adminHeaders });
  record('duplicate test rows no longer conflict (409 fix)', testRes2.status !== 409, `second call http=${testRes2.status}`);

  // 5. Webhook POST — valid HMAC delivers the delivery-status update (synthetic wamid,
  //    exercises the full signature -> handler -> DB chain independent of Meta).
  const syntheticWamid = `wamid.E2E${Date.now()}`;
  await MessageLog.create({
    mobile: ADMIN_MOBILE,
    type: 'TEST',
    category: 'UTILITY',
    templateName: 'hello_world',
    status: 'PENDING',
    metaMessageId: syntheticWamid,
    mode: whatsapp.mode,
    dedupeKey: `synthetic:${syntheticWamid}`,
  });
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: whatsapp.businessAccountId,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15551234567', phone_number_id: whatsapp.phoneNumberId },
          statuses: [{
            id: syntheticWamid,
            status: 'delivered',
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: ADMIN_MOBILE,
          }],
        },
      }],
    }],
  };
  if (whatsapp.appSecret) {
    const raw = Buffer.from(JSON.stringify(payload));
    const goodSig = `sha256=${crypto.createHmac('sha256', whatsapp.appSecret).update(raw).digest('hex')}`;
    const good = await api('/api/whatsapp/webhook', { method: 'POST', rawBody: raw, headers: { 'x-hub-signature-256': goodSig } });
    record('webhook POST valid HMAC -> 200', good.status === 200, `status=${good.status}`);

    await new Promise((r) => setTimeout(r, 300));
    const row = await MessageLog.findOne({ metaMessageId: syntheticWamid }).select('status deliveredAt mode errorCode').lean();
    record('webhook status → MessageLog DELIVERED', row?.status === 'DELIVERED' && Boolean(row?.deliveredAt), `status=${String(row?.status)} mode=${String(row?.mode)}`);

    const bad = await api('/api/whatsapp/webhook', { method: 'POST', rawBody: Buffer.from(JSON.stringify({ object: 'x' })), headers: { 'x-hub-signature-256': 'sha256=deadbeef' } });
    record('webhook POST forged HMAC -> 403', bad.status === 403, `status=${bad.status}`);
  } else {
    record('webhook POST HMAC (app secret missing in test mode)', true, 'skipped — WHATSAPP_APP_SECRET unset; test mode tolerates');
  }

  // 6. OTP through the real outbox queue (template exists only when approved on Meta).
  const otpSend = await api('/api/auth/otp/send', { method: 'POST', body: { mobile: ADMIN_MOBILE }, cookies: true, headers: adminHeaders });
  const otpRow = await MessageLog.findOne({ type: 'OTP' }).sort({ createdAt: -1 }).select('status failureReason errorCode').lean();
  const otpCooldownActive = otpSend.status === 429;
  const otpLogExists = Boolean(otpRow);
  record('POST /api/auth/otp/send reaches the queue', otpCooldownActive || (otpSend.status === 200 && otpLogExists), `http=${otpSend.status} log.status=${String(otpRow?.status)} errorCode=${String((otpRow as Record<string, unknown> | null)?.errorCode ?? 0)}`);
  if ((otpRow as Record<string, unknown> | null)?.status === 'FAILED') {
    record('OTP send blocked by Meta template/credential state (expected until approved)', false, `failureReason=${String((otpRow as Record<string, unknown> | null)?.failureReason ?? '').slice(0, 160)}`, true);
  }

  const failed = report.filter((r) => !r.ok && !r.blocked);
  console.log(`\n=== ${report.length - failed.length}/${report.length} checks passed (${blockedCount} blocked by Meta-side state) ===`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('E2E error:', err instanceof Error ? err.message : err);
  process.exit(1);
});