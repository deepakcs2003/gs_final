/**
 * Create every missing Guddi Silai WhatsApp template in the Meta WABA that the
 * current WHATSAPP_MODE points at. Run it against ANY WABA that permits template
 * creation (a business-verified production WABA does; the tutorial test WABA
 * blocks AUTHENTICATION templates with subcode 2388185).
 *
 *   npm run dev:wa-sync-templates
 *
 * Safe to re-run: existing templates (any status) are left untouched. Output is
 * one line per template; the "--meta" JSON has the full list of existing ones.
 */
import { env, whatsapp } from '../config/env.js';

const WABA = whatsapp.businessAccountId;
const TOKEN = whatsapp.accessToken;
const BASE = env.APP_BASE_URL.replace(/\/$/, '');
const AUTH_STATUS: string[] = [];

function parameterCount(body: string): number {
  const nums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

function exampleBody(body: string): Array<Array<string>> {
  const count = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).length;
  return [[...Array(count).keys()].map((i) => `value${i + 1}`)];
}

/** Build the POST body for Meta's message_templates endpoint. */
function createPayload(name: string, category: string, language: string, body: string, needsButton: boolean, buttonText: string): string {
  const components: unknown[] = [];
  if (name === 'guddi_otp') {
    // AUTHENTICATION body text is fixed by Meta (`*{{1}}* is your verification
    // code`) — text/example are NOT allowed; the flags + copy-code button are.
    components.push({ type: 'BODY', add_security_recommendation: true });
    components.push({ type: 'FOOTER', code_expiration_minutes: 5 });
    components.push({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] });
  } else {
    const textParams = parameterCount(body) > 0 ? { example: { body_text: exampleBody(body) } } : {};
    components.push({ type: 'BODY', text: body, ...textParams });
    if (needsButton) {
      components.push({
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: buttonText, url: `${BASE}/order/{{1}}`, example: [`${BASE}/order/GS12345`] },
        ],
      });
    }
  }
  return JSON.stringify({ name, category, language, components });
}

async function main(): Promise<void> {
  if (!WABA || !TOKEN) {
    console.log(`WhatsApp NOT configured for mode=${whatsapp.mode} (waba=${WABA ? 'set' : 'MISSING'} token=${TOKEN ? 'set' : 'MISSING'}). Abort.`);
    process.exit(1);
  }
  console.log(`mode=${whatsapp.mode} waba=${WABA}`);

  const res = await fetch(`https://graph.facebook.com/v25.0/${WABA}/message_templates?fields=name,status,category&limit=200`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const json = (await res.json()) as { data?: Array<{ name: string; status: string; category: string }>; error?: { message: string } };
  if (!res.ok) {
    console.log(`LIST FAIL: ${json.error?.message ?? `HTTP ${res.status}`}`);
    process.exit(1);
  }
  const existing = new Map((json.data ?? []).map((t) => [t.name, `${t.status}/${t.category}`]));
  console.log(`existing templates (${existing.size}):`);
  for (const [name, status] of existing) console.log(`  ${name} — ${status}`);
  console.log('---');

  for (const def of (await import('../services/whatsapp/templates.js')).TEMPLATE_REGISTRY) {
    const have = existing.get(def.name);
    if (have) {
      console.log(`SKIP  ${def.name} — already exists (${have})`);
      continue;
    }
    const payload = createPayload(def.name, def.category, 'en_US', def.body, def.needsButton, def.buttonText);
    const r = await fetch(`https://graph.facebook.com/v25.0/${WABA}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: payload,
    });
    const out = (await r.json()) as { id?: string; status?: string; error?: { message: string; code?: number } };
    if (r.ok && out.id) {
      console.log(`CREATE ${def.name} — id=${out.id} status=${out.status ?? '?'} (approval pending for UTILITY/MARKETING)`);
      AUTH_STATUS.push(`OK ${def.name} ${out.status ?? '?'}`);
    } else {
      const err = out.error?.message ?? `HTTP ${r.status}`;
      console.log(`ERROR ${def.name} — ${err}`);
      AUTH_STATUS.push(`FAIL ${def.name}: ${err}`);
    }
  }

  console.log('---');
  console.log('summary:');
  for (const line of AUTH_STATUS) console.log(`  ${line}`);
  console.log('\nNOTE: guddi_otp (AUTHENTICATION) needs business verification + messaging limit 2K.');
  console.log('NOTE: UTILITY/MARKETING templates go through Meta review (hours) before they can send.');
}

main().catch((err) => {
  console.error('sync failed', err);
  process.exit(1);
});