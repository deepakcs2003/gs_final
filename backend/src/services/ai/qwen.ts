import { z } from 'zod';
import { env, geminiApiKeys } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceUnavailable } from '../../utils/errors.js';

/**
 * "Generate with Qwen" — auto-fills the EXISTING admin Add-Product fields
 * from the selected product image(s). A multimodal LLM analyses the photo set,
 * keeping the existing admin workflow unchanged.
 *
 * Responsibility is deliberately narrow:
 *  - only fields that can be read off a photograph are returned;
 *  - business numbers (price, stock, sizes, SKU, designId…) are NEVER guessed;
 *  - the API key lives here, on the backend, and never reaches the browser.
 *
 * Integration is provider-agnostic, picked once per request:
 *  - PRIMARY: Google Gemini free tier (`GEMINI_API_KEY`). Cloud-hosted, free,
 *    no server RAM required, strong Indian-ethnic-wear vision, up to 8 images
 *    per request. Model set with `GEMINI_MODEL` (gemini-2.5-flash default;
 *    gemini-2.5-flash-lite for ~100x higher free daily limits).
 *  - FALLBACK: Groq (`GROQ_API_KEY`) serving qwen/qwen3.8-27b, OpenAI-compatible.
 * Gemini wins when its key is present; otherwise Groq is used if set.
 */

const QWEN_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const QWEN_TIMEOUT_MS = 30_000;

/** Pauses for the given milliseconds — lets a per-minute rate limit clear. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ProviderHttpError extends Error {
  /** HTTP-like status classified by the provider adapter. */
  status?: number;
  /**
   * true  → per-minute rate limit, worth a short backoff and retry;
   * false → daily quota / exhausted resources, retrying would just waste time.
   */
  retryable?: boolean;
}

/** 429 retries with backoff. Daily-quota 429s (retryable=false) are never retried. */
const RATE_LIMIT_BACKOFF_MS = [1_500, 3_000, 6_000];

async function chatWithRetry(model: string, prompt: string, assets: ImageAsset[], provider: AiProvider): Promise<ChatResult> {
  let lastError: ProviderHttpError | undefined;
  for (let i = 0; i < RATE_LIMIT_BACKOFF_MS.length; i += 1) {
    try {
      return await chatFor(model, prompt, assets, provider);
    } catch (err) {
      const httpErr = err as ProviderHttpError;
      lastError = httpErr;
      const status = qwenErrorStatus(err);
      if (status !== 429 || httpErr.retryable === false) throw err;
      if (i < RATE_LIMIT_BACKOFF_MS.length - 1) await sleep(RATE_LIMIT_BACKOFF_MS[i] ?? 1_500);
    }
  }
  if (lastError) throw lastError;
  throw new Error('rate limit retries exhausted');
}

/**
 * The model sometimes returns money as a string ("₹1,499", "1499") — normalise
 * to a non-negative whole rupee integer, or null when unreadable.
 */
function parseWholeInr(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const digits = value.replace(/[^0-9]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Price field that tolerates numeric strings and keeps a clean `number|null|undefined` output type. */
const inrField = (max: number) =>
  z.preprocess(parseWholeInr, z.number().int().min(0).max(max).nullable().optional()) as z.ZodType<number | null | undefined>;

/** Sole source of truth for the suggestion surface returned to the form. */
export const qwenSuggestionSchema = z
  .object({
    name: z.string().trim().max(140).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).nullable().optional(),
    embroidery: z.array(z.string().trim().min(1).max(40)).max(10).nullable().optional(),
    colors: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(40),
          // Tolerated loosely on purpose — qwen often returns hex without "#";
          // normalizeHex() canonicalises to #rrggbb or drops the colour later.
          hex: z.string().max(20),
        }),
      )
      // Loosely capped for model tolerance; the frontend applies only index 0 —
      // the rule "single dominant blouse colour" is enforced there.
      .max(3)
      .nullable()
      .optional(),
    categoryNames: z.array(z.string().trim().min(1).max(60)).max(5).nullable().optional(),
    priceInr: inrField(10_000_000),
    careInstructions: z.string().trim().max(600).nullable().optional(),
    seo: z
      .object({
        title: z.string().trim().max(70).nullable().optional(),
        description: z.string().trim().max(180).nullable().optional(),
        keywords: z.array(z.string().trim().min(1).max(40)).max(10).nullable().optional(),
      })
      .nullable()
      .optional(),
  });

export type QwenSuggestion = z.infer<typeof qwenSuggestionSchema>;

export const ourWorkSuggestionSchema = z.object({
  title: z.string().trim().max(140).nullable().optional(),
  description: z.string().trim().max(180).nullable().optional(),
  feedback: z.string().trim().max(2000).nullable().optional(),
  customerNames: z.string().trim().max(200).nullable().optional(),
});
const INDIAN_WOMEN_NAMES = [
  // North and Hindi belt
  'Aarohi', 'Aashi', 'Aastha', 'Ananya', 'Anika', 'Anjali', 'Anushka', 'Apoorva', 'Avni', 'Bhavna',
  'Chahat', 'Charu', 'Diya', 'Divya', 'Esha', 'Gauri', 'Ishita', 'Jahnavi', 'Kajal', 'Kavya',
  'Kiran', 'Komal', 'Kritika', 'Lavanya', 'Madhavi', 'Mahima', 'Mansi', 'Meena', 'Meera', 'Muskan',
  'Naina', 'Navya', 'Neha', 'Nidhi', 'Nikita', 'Pallavi', 'Pari', 'Pihu', 'Prachi', 'Pragya',
  'Preeti', 'Priya', 'Radhika', 'Rashi', 'Reena', 'Rhea', 'Riya', 'Sakshi', 'Saloni', 'Shalini',
  'Shreya', 'Simran', 'Sneha', 'Sonali', 'Swati', 'Tanisha', 'Tanya', 'Trisha', 'Vani', 'Vidhi',
  // West and central India
  'Aditi', 'Amruta', 'Apeksha', 'Bhakti', 'Diksha', 'Harshada', 'Hetal', 'Ira', 'Jigna', 'Jyoti',
  'Kashish', 'Khushi', 'Mitali', 'Mokshada', 'Mrunal', 'Nandini', 'Nimisha', 'Pooja', 'Rutuja', 'Sakina',
  'Sonal', 'Tejal', 'Vaishnavi', 'Zoya',
  // South India
  'Akshara', 'Amritha', 'Anagha', 'Ananya', 'Aparna', 'Archana', 'Bhavana', 'Deepa', 'Harini', 'Keerthi',
  'Lakshmi', 'Malavika', 'Manya', 'Mahalakshmi', 'Nandita', 'Nivedita', 'Pavithra', 'Pooja', 'Ramya', 'Revathi',
  'Sahana', 'Sanjana', 'Shilpa', 'Shruthi', 'Sindhu', 'Sowmya', 'Swetha', 'Tejaswini', 'Varsha', 'Yamuna',
  // East and Northeast India
  'Aindrila', 'Arpita', 'Brishti', 'Debolina', 'Ishani', 'Koyel', 'Laboni', 'Madhumita', 'Moumita', 'Mrittika',
  'Rimjhim', 'Roshni', 'Sampa', 'Sanchari', 'Saswati', 'Sharmila', 'Srabani', 'Tanushree', 'Tiyasha', 'Madhurima',
  'Anwesha', 'Dikshita', 'Junali', 'Lopamudra', 'Madhurima', 'Mitali', 'Monalisa', 'Priyanka', 'Rupali', 'Udita',
];

const OUR_WORK_PROMPT = `You are helping an Indian blouse gallery prepare a compact WhatsApp-style review display for an admin to review. Analyze the uploaded work photos and return ONLY JSON with title, description, feedback, customerNames. Keep the title short. Keep description factual, visible, and to 1-2 short lines. Generate customerNames as a comma-separated string with 2-7 Indian WOMEN'S names only, never men's names. Names should represent all Indian regions: Hindi/North, Marathi/Gujarati/West, Tamil/Telugu/Kannada/Malayalam/South, Bengali/Odia/Assamese/East and Northeast. Prefer a natural random mix with a mild Hindi/North majority, not the same common names every time. For feedback, create 3-8 short WhatsApp-style review lines separated by " || ", with a Hindi/Hinglish majority and some English and regional Indian languages. Keep each line natural and max 70 characters. Do not include ratings, orders, promises, invented facts, or labels such as AI, demo, sample, or generated. Use null only when photos do not support a field.`;

const PROMPT = `You are a careful catalogue assistant for an Indian ethnic-wear store.

You will receive several photographs of ONE blouse. The FIRST image is the main/front shot; the following images are additional views (back, sleeve, neckline, close-ups, etc.). Look at the WHOLE set and combine what is visible across them. Return ONLY a JSON object with these keys, and put null for anything you cannot confidently determine from the images:

- "name": short catalogue product name (max 140 chars, no quotes or emojis).
- "description": 1-3 sentence selling description (max 2000 chars). Only say what is visible.
- "tags": up to 8 short lowercase tags (e.g. ["blouse","handloom"]). Only clearly relevant ones.
- "embroidery": up to 8 embroidery/work details if visibly identifiable (e.g. zari, gota, sequin). Empty array if none visible.
- "colors": EXACTLY ONE element — only the single dominant colour of the blouse. Format { "name": "simple english name", "hex": lowercase 6-digit hex like #a0342b }. Never more than one entry.
- "categoryNames": array of 1 to 3 short categories a single blouse like this could belong to from a women's ethnic-wear catalogue (e.g. Blouse, Silk, Handloom, Heritage, Bridal, Party, Daily Wear, Casual). Empty array if unsure.
- "priceInr": an estimated retail price in whole Indian rupees for a blouse like this (between 250 and 250000), judged from the visible craftsmanship, fabric and embellishment. Be conservative and realistic; null if the images give no solid basis.
- "careInstructions": 1 short sentence of visible-care advice ONLY if an image shows a care label; otherwise null.
- "seo": { "title": max 70 chars, "description": max 180 chars, "keywords": up to 8 short lowercase keywords }.

STRICT RULES — you have no business data, so NEVER invent it:
- Do NOT guess price, MRP, discount, stock, sizes, SKU, brand, fabric composition percentage, or a design ID.
- If the type of garment or colour is ambiguous, return null / empty rather than guessing.
- Keep only factual, visible observations. No promotional fluff, no invented specs, no markdown, no code fences — pure JSON.`;

const colorSpecSchema = z.object({ name: z.string().trim().min(1).max(40), hex: z.string() });

/** Accepts #abc / #aabbcc / aabbcc and normalises to #rrggbb lowercase. */
function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{3,6}$/.test(cleaned)) return null;
  if (cleaned.length === 3) return `#${cleaned.split('').map((c) => c + c).join('')}`;
  if (cleaned.length === 6) return `#${cleaned}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Catalog suggestions — fabric / lace / latkan (the admin Catalog module)      */
/* -------------------------------------------------------------------------- */

export const fabricSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    material: z.string().trim().min(1).max(40).nullable().optional(),
    colorName: z.string().trim().min(1).max(40).nullable().optional(),
    colorHex: z.string().max(20).nullable().optional(),
    embroidery: z.array(z.string().trim().min(1).max(40)).max(8).nullable().optional(),
    priceInr: inrField(1_000_000),
  });

export const laceSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    colorName: z.string().trim().min(1).max(40).nullable().optional(),
    colorHex: z.string().max(20).nullable().optional(),
    priceInr: inrField(100_000),
  });

export const latkanSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    colorName: z.string().trim().min(1).max(40).nullable().optional(),
    colorHex: z.string().max(20).nullable().optional(),
    priceInr: inrField(100_000),
  });

const FABRIC_PROMPT = `You are a careful catalogue assistant for an Indian ethnic-wear store.

Look at the attached FABRIC photograph. Return ONLY a JSON object with these keys, and put null for anything you cannot confidently determine from the image:

- "name": short fabric name (max 80 chars, no quotes or emojis), e.g. "Banarasi Pure Silk".
- "material": the broad material family (max 40 chars) — one of: Silk, Georgette, Satin, Chiffon, Velvet, Net, Organza, Cotton, Raw Silk, Cotton Silk, Brocade, Kanjivaram, Banarasi, Chanderi, Designer, or similar.
- "colorName": the single dominant colour of the fabric in simple English.
- "colorHex": lowercase 6-digit hex like #a0342b matching that dominant colour.
- "embroidery": up to 8 embroidery/work details if visibly identifiable (e.g. zari, gota, sequin, mirror, thread, stone). Empty array if none.
- "priceInr": an estimated retail price in whole Indian rupees PER METRE for a fabric like this (between 50 and 40000), judged from the material and craftsmanship. Be conservative; null if the image gives no solid basis.

STRICT RULES — keep only visible, factual observations. No invented specs, no promotional fluff, no markdown, no code fences — pure JSON.`;

const LACE_PROMPT = `You are a careful catalogue assistant for an Indian ethnic-wear store.

Look at the attached LACE photograph (decorative border/trims used on blouses). Return ONLY a JSON object with these keys, and put null for anything you cannot confidently determine from the image:

- "name": short lace name (max 80 chars, no quotes or emojis), e.g. "Golden Zari Lace".
- "colorName": the single dominant colour of the lace in simple English.
- "colorHex": lowercase 6-digit hex like #c9a227 matching that dominant colour.
- "priceInr": an estimated retail price in whole Indian rupees per metre/pack for a lace like this (between 20 and 30000), judged from the visible work. Be conservative; null if unsure.

STRICT RULES — keep only visible, factual observations. No invented specs, no promotional fluff, no markdown, no code fences — pure JSON.`;

const LATKAN_PROMPT = `You are a careful catalogue assistant for an Indian ethnic-wear store.

Look at the attached LATKAN photograph. Latkans are decorative danglers/tassels used at the front or sleeves of a choli/blouse. Return ONLY a JSON object with these keys, and put null for anything you cannot confidently determine from the image:

- "name": short latkan name (max 80 chars, no quotes or emojis), e.g. "Pearl Tassel Latkan".
- "colorName": the single dominant colour in simple English.
- "colorHex": lowercase 6-digit hex like #e8dcc8 matching that dominant colour.
- "priceInr": an estimated retail price in whole Indian rupees PER PAIR for a latkan set like this (between 10 and 30000), judged from the visible material. Be conservative; null if unsure.

STRICT RULES — keep only visible, factual observations. No invented specs, no promotional fluff, no markdown, no code fences — pure JSON.`;

/**
 * Turns model output into schema-tolerable shape. Small vision models (especially
 * qwen via Groq) routinely return `tags`/`embroidery`/`keywords` as a single
 * comma string, hex without "#", oversized text, or numbers where text is
 * expected — each of those used to fail schema validation with a generic
 * "sahi format mein nahi tha". This repairs the common cases before validation.
 */
const TEXT_LIMITS: Record<string, number> = {
  name: 80,
  description: 2000,
  careInstructions: 600,
  material: 40,
  colorName: 40,
};

function toCleanStringArray(value: unknown, max: number): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? [value]
      : [];
  return raw
    .map((v) => (typeof v === 'string' ? v : v && typeof v !== 'object' ? String(v) : ''))
    .map((s) => s.trim().slice(0, 60))
    .filter((s) => s.length > 0)
    .slice(0, max);
}

function repairSuggestion(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };

  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const v = out[key];
    if (typeof v === 'string') {
      const s = v.trim();
      out[key] = s.length > limit ? s.slice(0, limit) : s;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = String(v);
    }
  }

  if (typeof out.tags !== 'undefined') out.tags = toCleanStringArray(out.tags, 10);
  if (typeof out.embroidery !== 'undefined') out.embroidery = toCleanStringArray(out.embroidery, 8);
  if (typeof out.categoryNames !== 'undefined') out.categoryNames = toCleanStringArray(out.categoryNames, 5);

  if (typeof out.colors !== 'undefined' && out.colors !== null) {
    const rawColors = Array.isArray(out.colors) ? out.colors : [out.colors];
    out.colors = rawColors
      .map((c): { name: string; hex: string } | null => {
        if (!c || typeof c !== 'object') return null;
        const color = c as Record<string, unknown>;
        const name = typeof color.name === 'string' ? color.name.trim() : String(color.name ?? '').trim();
        const hex = typeof color.hex === 'string' ? color.hex.trim() : String(color.hex ?? '').trim();
        return name ? { name: name.slice(0, 40), hex: hex.slice(0, 20) } : null;
      })
      .filter((c): c is { name: string; hex: string } => Boolean(c))
      .slice(0, 3);
  }

  if (out.seo && typeof out.seo === 'object' && !Array.isArray(out.seo)) {
    const seo = out.seo as Record<string, unknown>;
    const title = typeof seo.title === 'string' ? seo.title.trim() : String(seo.title ?? '').trim();
    const description = typeof seo.description === 'string' ? seo.description.trim() : String(seo.description ?? '').trim();
    out.seo = {
      title: title ? title.slice(0, 70) : null,
      description: description ? description.slice(0, 180) : null,
      keywords: typeof seo.keywords === 'undefined' ? undefined : toCleanStringArray(seo.keywords, 10),
    };
  }

  return out;
}

/** Validate/fetch a remote image; Gemini consumes it as base64 inline data. */
async function fetchImageBytes(imageUrl: string): Promise<{ mimeType: string; b64: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`image fetch failed: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`not an image: ${contentType}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > QWEN_MAX_IMAGE_BYTES) {
      throw new Error(`image size ${bytes.length} out of range`);
    }

    return {
      mimeType: (contentType.split(';')[0] ?? '').trim() || 'image/jpeg',
      b64: bytes.toString('base64'),
    };
  } finally {
    clearTimeout(timer);
  }
}

interface ImageAsset {
  url: string;
  mimeType: string;
  b64: string;
}

/** Probe every image URL up front so a bad URL fails fast with one friendly error. */
async function fetchImageAssets(imageUrls: string[]): Promise<ImageAsset[]> {
  const urls = [...imageUrls].slice(0, 8);
  return Promise.all(urls.map(async (url) => ({ url, ...(await fetchImageBytes(url)) })));
}

/** Home-grown JSON extraction — models sometimes wrap the object in fences/text. */
function extractJson(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/** Extracts a numeric HTTP status from any thrown/HTTP error shape (status/statusCode/code). */
function qwenErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code'] as const) {
    const value = record[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

interface ChatResult {
  text: string;
  finishReason?: string;
}

/**
 * One call to the Groq OpenAI-compatible chat completions endpoint. The
 * image(s) are passed as public URLs (same URLs the form already uploaded to
 * Cloudinary). Non-2xx responses throw an Error carrying the HTTP status so the
 * caller can classify quota/model/key/5xx and retry where it helps.
 */
async function qwenChat(model: string, prompt: string, assets: ImageAsset[]): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              ...assets.map((asset) => ({ type: 'image_url', image_url: { url: asset.url } })),
              { type: 'text', text: prompt },
            ],
          },
        ],
        temperature: 0.4,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { error?: { message?: string; code?: string } };
        detail = body.error?.message ? `${body.error.code ? `${body.error.code}: ` : ''}${body.error.message}` : '';
      } catch {
        /* non-JSON error body — fall through */
      }
      const error = new Error(detail || `qwen chat completions failed: HTTP ${response.status}`) as ProviderHttpError;
      error.status = response.status;
      // Groq 429s are day- and minute-rate limits together; assume per-minute,
      // which means a short backoff can clear them (quota flag still recorded).
      error.retryable = response.status === 429;
      if (detail) logger.warn({ model, status: response.status, detail }, 'qwen: chat completions rejected');
      throw error;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      error?: { message?: string; code?: string };
    };
    if (data.error) {
      const error = new Error(data.error.message ?? 'qwen response carried an error') as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One call to Google's Gemini generateContent endpoint (free tier). Images go
 * as base64 `inline_data` parts — the bytes are fetched by the backend, so the
 * model never needs direct URL access. RPC-style status names are mapped to an
 * HTTP-like status on the thrown Error so the shared classifier can handle both
 * providers identically.
 */
async function geminiChat(model: string, prompt: string, assets: ImageAsset[], apiKey: string): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.GEMINI_BASE_URL}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              ...assets.map((asset) => ({ inline_data: { mime_type: asset.mimeType, data: asset.b64 } })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      error?: { code?: number; status?: string; message?: string };
    };

    if (!response.ok || data.error) {
      const statusName = data.error?.status ?? '';
      const googleStatusToHttp: Record<string, number> = {
        RESOURCE_EXHAUSTED: 429,
        QUOTA_EXCEEDED: 429,
        RATE_LIMIT_EXCEEDED: 429,
        PERMISSION_DENIED: 403,
        UNAUTHENTICATED: 403,
        API_KEY_INVALID: 403,
        NOT_FOUND: 404,
        INVALID_ARGUMENT: 400,
        INTERNAL: 500,
        UNAVAILABLE: 503,
        DEADLINE_EXCEEDED: 504,
      };
      const status = googleStatusToHttp[statusName] ?? data.error?.code ?? response.status ?? 500;

      const detail = data.error?.message ?? '';
      const error = new Error(detail || `gemini generateContent failed: HTTP ${response.status}`) as ProviderHttpError;
      error.status = status;
      // RATE_LIMIT_EXCEEDED = per-minute (retryable with backoff);
      // RESOURCE_EXHAUSTED / QUOTA_EXCEEDED = daily quota — don't wait, fall over.
      error.retryable = statusName === 'RATE_LIMIT_EXCEEDED';
      if (detail) logger.warn({ model, status, detail }, 'gemini: generateContent rejected');
      throw error;
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    return { text, finishReason: candidate?.finishReason };
  } finally {
    clearTimeout(timer);
  }
}

interface AiProvider {
  kind: 'gemini' | 'groq';
  name: string;
  models: string[];
  apiKey?: string;
}

/**
 * Provider order for every request: Gemini (free tier) first, then Groq. When
 * one provider hit its rate limit / quota, has a bad key or a transient
 * error, the NEXT provider takes over automatically — a request only fails
 * when every configured provider has failed.
 */
function buildProviders(): AiProvider[] {
  const list: AiProvider[] = [];
  const keys = geminiApiKeys.length > 0 ? geminiApiKeys : env.GEMINI_API_KEY ? [env.GEMINI_API_KEY] : [];
  const geminiModelFallbacks = Array.from(
    new Set([
      env.GEMINI_MODEL?.trim(),
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
    ].filter(Boolean) as string[]),
  );

  for (const [index, key] of keys.entries()) {
    list.push({
      kind: 'gemini',
      name: `Gemini (${index + 1})`,
      models: geminiModelFallbacks,
      apiKey: key,
    });
  }
  if (env.GROQ_API_KEY) {
    list.push({ kind: 'groq', name: 'Groq', models: candidates });
  }
  return list;
}

/** Routes one vision call through the right provider's transport. */
function chatFor(model: string, prompt: string, assets: ImageAsset[], provider: AiProvider): Promise<ChatResult> {
  return provider.kind === 'gemini' ? geminiChat(model, prompt, assets, provider.apiKey ?? env.GEMINI_API_KEY) : qwenChat(model, prompt, assets);
}

/** Which classes of failure happened — the final user message is built from these per provider. */
interface FailureFlags {
  /** Daily quota genuinely exhausted (Gemini RESOURCE_EXHAUSTED). */
  quota: boolean;
  /** Per-minute / transient rate limit that survived the internal backoff retries. */
  rateLimit: boolean;
  auth: boolean;
  notFound: boolean;
  bad: boolean;
  server: boolean;
  network: boolean;
}

function trackFailure(flags: FailureFlags, status: number | undefined, retryable?: boolean): void {
  if (status === 429) {
    // retryable === false → daily quota/resources gone; retryable|undefined → per-minute rate limit.
    if (retryable === false) flags.quota = true;
    else flags.rateLimit = true;
  } else if (status === 401 || status === 403) flags.auth = true;
  else if (status === 404) flags.notFound = true;
  else if (status === 400) flags.bad = true;
  else if (status !== undefined && status >= 500) flags.server = true;
  else flags.network = true;
}

function describeFlags(f: FailureFlags | undefined): string {
  if (!f) return 'fail';
  const bits: string[] = [];
  if (f.quota) bits.push('daily quota khatam');
  if (f.rateLimit) bits.push('rate limit (abhi busy)');
  if (f.auth) bits.push('API key sahi nahi');
  if (f.notFound) bits.push('model mila nahi');
  if (f.server) bits.push('server problem');
  if (f.network) bits.push('network');
  if (f.bad) bits.push('request galat');
  return bits.length ? bits.join(', ') : 'fail';
}

/** User-safe message when no provider could produce a usable answer — truthfully scoped per provider. */
function finalStatusMessage(providerNames: ReadonlySet<string>, byProvider: ReadonlyMap<string, FailureFlags>): string {
  const names = [...providerNames];

  const allQuota = names.length > 0 && names.every((name) => byProvider.get(name)?.quota);
  if (allQuota) {
    if (names.length === 1) {
      return names[0] === 'Gemini (free tier)'
        ? 'Gemini free tier ki daily quota khatam — aaj ke liye AI use nahi hoga. Kal phir chali jayegi.'
        : 'Groq ki daily quota khatam — kal phir try karein.';
    }
    return `Dono AI services (${names.join(' + ')}) ki daily quota khatam — aaj ke liye AI use nahi hoga. Kal phir chali jayegi.`;
  }

  const allLimits = names.length > 0 && names.every((name) => {
    const f = byProvider.get(name);
    return !f || f.quota || f.rateLimit;
  });
  if (allLimits) {
    return 'AI services abhi busy hain (rate limit) — 1-2 minute baad dobara try karein.';
  }

  const details = names.map((name) => `${name}: ${describeFlags(byProvider.get(name))}`);
  return `AI ka jawab nahi aaya. ${details.join(' | ')} — dobara try karein.`;
}

/**
 * Shared core: fetches the images once, then asks EACH configured vision
 * provider (Gemini first, then Groq) for JSON and validates it against the
 * caller's schema. Provider failover is automatic — a rate limit, bad key or
 * transient error on one provider immediately falls over to the next, so a
 * second key only gets used when the first needs a break. All failures become
 * user-safe AppErrors; internal details stay in logs.
 */
async function generateStructured<T extends Record<string, unknown>>(args: {
  imageUrls: string[];
  prompt: string;
  schema: z.ZodType<T>;
  nodeName: string;
}): Promise<T> {
  const providers = buildProviders();
  if (providers.length === 0) {
    throw serviceUnavailable(
      'AI abhi set nahi hai — GEMINI_API_KEY_1 / GEMINI_API_KEY_2 / GEMINI_API_KEY_3 / GEMINI_API_KEY_4 ya GROQ_API_KEY backend .env mein daalein.',
    );
  }

  let assets: ImageAsset[];
  try {
    assets = await fetchImageAssets(args.imageUrls);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'ai: image could not be fetched');
    throw serviceUnavailable('Image download nahi hua — URL check karein ya image dobara upload karein.');
  }
  if (assets.length === 0) {
    throw serviceUnavailable('Image download nahi hua — URL check karein ya image dobara upload karein.');
  }

  const flagsByProvider = new Map<string, FailureFlags>();
  const requestFailureFlags = (name: string): FailureFlags => {
    let f = flagsByProvider.get(name);
    if (!f) {
      f = { quota: false, rateLimit: false, auth: false, notFound: false, bad: false, server: false, network: false };
      flagsByProvider.set(name, f);
    }
    return f;
  };
  const attemptedProviders = new Set<string>();
  let lastFailure: { kind: 'model' | 'parse' | 'schema' | 'status' | 'blocked'; status?: number; reason?: string; preview?: string; provider?: string } | null = null;

  // Several dice rolls per provider, then the next provider, then another
  // whole attempt — but only when a response came back that just didn't parse.
  // If a provider hard-fails (quota/key/server), moving on to the next
  // provider IS the retry.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let producedText = false;
    for (const provider of providers) {
      attemptedProviders.add(provider.name);

      let text = '';
      let blocked: string | null = null;
      for (const model of provider.models) {
        try {
          const result = await chatWithRetry(model, args.prompt, assets, provider);
          const finishReason = result.finishReason?.toLowerCase();
          // Content filtering returns no text at all — the same provider will
          // block again, so surface it instead of burning more attempts.
          if (!result.text.trim() && finishReason && !['stop', 'length', 'max_tokens'].includes(finishReason)) {
            blocked = result.finishReason ?? 'blocked';
            break;
          }
          if (finishReason === 'length' || finishReason === 'max_tokens') {
            logger.warn({ model, node: args.nodeName }, 'ai: response cut at max_tokens');
          }
          text = result.text;
          break;
        } catch (err) {
          const status = qwenErrorStatus(err);
          const httpErr = err as ProviderHttpError;
          trackFailure(requestFailureFlags(provider.name), status, httpErr.retryable);
          lastFailure = { kind: 'status', status, provider: provider.name, reason: err instanceof Error ? err.message : String(err) };
          logger.warn(
            { model, provider: provider.name, node: args.nodeName, status, err: err instanceof Error ? err.message : String(err) },
            'ai: provider call failed',
          );
          // Next model, then next provider.
        }
      }

      if (blocked) {
        lastFailure = { kind: 'blocked', reason: blocked, provider: provider.name };
        break;
      }
      if (!text) continue;

      producedText = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(text));
      } catch (err) {
        const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
        lastFailure = { kind: 'parse', preview, provider: provider.name };
        logger.warn({ node: args.nodeName, provider: provider.name, err: (err as Error).message, preview }, 'ai: response was not valid JSON');
        continue;
      }

      const validation = args.schema.safeParse(repairSuggestion(parsed));
      if (validation.success) return validation.data;
      const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
      lastFailure = { kind: 'schema', preview, provider: provider.name };
      logger.warn(
        { node: args.nodeName, provider: provider.name, issues: validation.error.issues, preview },
        'ai: response failed schema validation',
      );
      // Text came back but didn't validate — try the next provider.
    }

    // Harmless-parse failures get another attempt roll; everything else stops
    // looping because retrying only wastes quota.
    if (lastFailure && !['parse', 'schema'].includes(lastFailure.kind)) break;
    if (!producedText && lastFailure?.kind === 'status') break;
  }

  if (lastFailure?.kind === 'blocked') {
    throw serviceUnavailable(
      `${lastFailure.provider ?? 'AI'} ne image se details nahi nikaali (content filter). Alag angle/photo try karein.`,
    );
  }
  if (lastFailure?.kind === 'parse') {
    throw serviceUnavailable(`${lastFailure.provider ?? 'AI'} ka response samajh nahi aaya — dobara try karein.`);
  }
  if (lastFailure?.kind === 'schema') {
    throw serviceUnavailable(`${lastFailure.provider ?? 'AI'} ka response sahi format mein nahi tha — dobara try karein.`);
  }
  if (lastFailure?.kind === 'status') {
    throw serviceUnavailable(finalStatusMessage(attemptedProviders, flagsByProvider));
  }
  throw serviceUnavailable(`${[...attemptedProviders].join(' + ') || 'AI'} ka jawab sahi nahi aaya — dobara try karein.`);
}

/** Explicit QWEN_MODEL wins; otherwise the configured Qwen-VL served by Groq. */
const candidates = Array.from(
  new Set([env.QWEN_MODEL?.trim(), 'qwen/qwen3.8-27b'].filter(Boolean) as string[]),
);

/**
 * Analyses the product images (front first, then back/sleeve/close-ups) and
 * returns suggestions for the EXISTING Add Product fields. Throws user-safe
 * AppErrors; internal details stay in logs.
 */
export async function generateProductSuggestions(imageUrls: string[]): Promise<QwenSuggestion> {
  const sugg = await generateStructured({ imageUrls, prompt: PROMPT, schema: qwenSuggestionSchema, nodeName: 'product' });

  // Normalise colour hexes; drop any colour whose hex can't be cleaned up.
  const colors = (sugg.colors ?? []).flatMap((c) => {
    const hex = normalizeHex(c.hex);
    return hex ? [{ name: c.name, hex }] : [];
  });

  return {
    name: sugg.name || null,
    description: sugg.description || null,
    tags: sugg.tags?.length ? sugg.tags : null,
    embroidery: sugg.embroidery?.length ? sugg.embroidery : null,
    colors: colors.length ? colors : null,
    categoryNames: sugg.categoryNames?.length ? sugg.categoryNames : null,
    priceInr: sugg.priceInr || null,
    careInstructions: sugg.careInstructions || null,
    seo: sugg.seo
      ? {
          title: sugg.seo.title || null,
          description: sugg.seo.description || null,
          keywords: sugg.seo.keywords?.length ? sugg.seo.keywords : null,
        }
      : null,
  };
}

function nameKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-IN').replace(/[^a-z\u0900-\u097f]/g, '');
}

function pickFreshWomenNames(usedNames: string[]): string {
  const used = new Set(usedNames.flatMap((value) => value.split(',')).map(nameKey).filter(Boolean));
  const available = Array.from(new Set(INDIAN_WOMEN_NAMES)).filter((name) => !used.has(nameKey(name)));
  const pool = available.length >= 2 ? available : Array.from(new Set(INDIAN_WOMEN_NAMES));
  const count = Math.min(pool.length, 2 + Math.floor(Math.random() * 6));
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current !== undefined && replacement !== undefined) {
      shuffled[index] = replacement;
      shuffled[swapIndex] = current;
    }
  }
  return shuffled.slice(0, count).join(', ');
}

export async function generateOurWorkSuggestions(imageUrls: string[], usedNames: string[] = []): Promise<z.infer<typeof ourWorkSuggestionSchema>> {
  const suggestion = await generateStructured({ imageUrls, prompt: OUR_WORK_PROMPT, schema: ourWorkSuggestionSchema, nodeName: 'our-work' });
  return { ...suggestion, customerNames: pickFreshWomenNames(usedNames) };
}

export async function generateFabricSuggestion(imageUrl: string): Promise<z.infer<typeof fabricSuggestionSchema>> {
  const sugg = await generateStructured({ imageUrls: [imageUrl], prompt: FABRIC_PROMPT, schema: fabricSuggestionSchema, nodeName: 'fabric' });
  return { ...sugg, colorHex: sugg.colorHex ? normalizeHex(sugg.colorHex) : sugg.colorHex };
}

export async function generateLaceSuggestion(imageUrl: string): Promise<z.infer<typeof laceSuggestionSchema>> {
  const sugg = await generateStructured({ imageUrls: [imageUrl], prompt: LACE_PROMPT, schema: laceSuggestionSchema, nodeName: 'lace' });
  return { ...sugg, colorHex: sugg.colorHex ? normalizeHex(sugg.colorHex) : sugg.colorHex };
}

export async function generateLatkanSuggestion(imageUrl: string): Promise<z.infer<typeof latkanSuggestionSchema>> {
  const sugg = await generateStructured({ imageUrls: [imageUrl], prompt: LATKAN_PROMPT, schema: latkanSuggestionSchema, nodeName: 'latkan' });
  return { ...sugg, colorHex: sugg.colorHex ? normalizeHex(sugg.colorHex) : sugg.colorHex };
}