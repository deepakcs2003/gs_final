import { z } from 'zod';
import { env, integrations } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceUnavailable } from '../../utils/errors.js';

/**
 * "Generate with Qwen" — auto-fills the EXISTING admin Add-Product fields
 * from the selected product image(s). Qwen-VL is served through the Groq API
 * (hosted inference), keeping the existing admin workflow unchanged.
 *
 * Responsibility is deliberately narrow:
 *  - only fields that can be read off a photograph are returned;
 *  - business numbers (price, stock, sizes, SKU, designId…) are NEVER guessed;
 *  - the API key lives here, on the backend, and never reaches the browser.
 *
 * Integration: official Groq API "OpenAI-compatible" chat completions endpoint
 * (https://console.groq.com/docs). Defaults to the official
 * https://api.groq.com/openai/v1 base and can be overridden with GROQ_BASE_URL.
 * The vision model defaults to qwen/qwen3.8-27b and can be overridden with
 * QWEN_MODEL.
 */

const QWEN_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const QWEN_TIMEOUT_MS = 30_000;

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
          hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
function normalizeHex(raw: string): string | null {
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

/** Validate/fetch the remote image (still public — Qwen-VL reads it via URL). */
async function fetchImageBytes(imageUrl: string): Promise<{ mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`image fetch failed: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`not an image: ${contentType}`);

    const blob = await response.blob();
    if (blob.size === 0 || blob.size > QWEN_MAX_IMAGE_BYTES) {
      throw new Error(`image size ${blob.size} out of range`);
    }

    return { mimeType: (contentType.split(';')[0] ?? '').trim() || 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every image URL up front so a bad URL fails fast with one friendly error. */
async function fetchImageUrls(imageUrls: string[]): Promise<string[]> {
  const urls = [...imageUrls].slice(0, 8);
  await Promise.all(urls.map((url) => fetchImageBytes(url)));
  return urls;
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
async function qwenChat(model: string, prompt: string, imageUrls: string[]): Promise<ChatResult> {
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
              { type: 'image_url', image_url: { url: imageUrls[0] } },
              ...imageUrls.slice(1).map((url) => ({ type: 'image_url', image_url: { url } })),
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
      const error = new Error(detail || `qwen chat completions failed: HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
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

/** Rethrows a Qwen failure as a user-safe AppError, after logging the detail. */
function throwMappedQwenError(err: unknown, status: number | undefined, model: string): never {
  const cause = err instanceof Error && err.cause ? String((err.cause as Error).message ?? err.cause) : '';
  logger.warn(
    {
      model,
      err: { name: err instanceof Error ? err.name : 'Error', message: err instanceof Error ? err.message : String(err), status },
      cause,
    },
    'qwen: chat completions failed',
  );
  if (status === 429) {
    throw serviceUnavailable('Groq quota/rate limit aa gayi — thodi der baad try karein.');
  }
  if (status === 404) {
    throw serviceUnavailable('Qwen model available nahi hai — Groq console mein model enable karein (qwen/qwen3.8-27b) ya QWEN_MODEL set karein.');
  }
  if (status === 401 || status === 403) {
    throw serviceUnavailable('Groq API key sahi nahi hai — GROQ_API_KEY check karein.');
  }
  if (status === 400) {
    throw serviceUnavailable('Groq request sahi nahi thi ya image accessible nahi — image URL check karein aur dobara try karein.');
  }
  if (status !== undefined && status >= 500) {
    throw serviceUnavailable('Groq server par problem aa gayi — thodi der baad try karein.');
  }
  // No HTTP status at all → connection/network failure, blocking, timeout.
  throw serviceUnavailable('Qwen se connect nahi ho paya — internet/network check karein aur dobara try karein.');
}

/**
 * Shared Qwen core: fetches the images, loops over model candidates (a 404 on
 * one model falls back to the next, so a key with partial model access still
 * works), parses the JSON and validates it against the caller's schema.
 * All failures become user-safe AppErrors; internal details stay in logs.
 */
async function generateStructured<T extends Record<string, unknown>>(args: {
  imageUrls: string[];
  prompt: string;
  schema: z.ZodType<T>;
  nodeName: string;
}): Promise<T> {
  if (!integrations.qwen) {
    throw serviceUnavailable('Qwen abhi set nahi hai — GROQ_API_KEY backend .env mein daalein.');
  }

  let imageUrls: string[];
  try {
    imageUrls = await fetchImageUrls(args.imageUrls);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'qwen: image could not be fetched');
    throw serviceUnavailable('Image download nahi hua — URL check karein ya image dobara upload karein.');
  }
  if (imageUrls.length === 0) {
    throw serviceUnavailable('Image download nahi hua — URL check karein ya image dobara upload karein.');
  }

  // Syntax/schema slips and transient 5xx are tolerable: the model gets more
  // rolls of the dice (more attempts, then the next candidate model) before we
  // surface a user-safe error. Authoritative failures (bad key, quota, 4xx)
  // are still surfaced immediately — retrying those only wastes API calls.
  let responseText = '';
  let lastFailure: { kind: 'model' | 'parse' | 'schema' | 'status' | 'blocked'; status?: number; reason?: string; preview?: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    responseText = '';
    for (const model of candidates) {
      try {
        const result = await qwenChat(model, args.prompt, imageUrls);
        const finishReason = result.finishReason;
        // Content filtering returns no text at all — the same model will block
        // again, so don't burn the remaining attempt roll on it. Surface a
        // readable reason instead of the misleading "model unavailable" text.
        if (!result.text.trim() && finishReason && !['stop', 'length'].includes(finishReason)) {
          lastFailure = { kind: 'blocked', reason: String(finishReason) };
          responseText = '';
          break;
        }
        if (finishReason === 'length' && result.text.trim()) {
          logger.warn({ model, node: args.nodeName }, 'qwen: response cut at max_tokens');
        }
        responseText = result.text;
        break;
      } catch (err) {
        const status = qwenErrorStatus(err);
        // 404 = model not accessible with this key — try the next candidate.
        // 5xx / no status = transient server or network trouble — also try the
        // next candidate before giving up.
        if (status === 404 || status === undefined || status >= 500) {
          lastFailure = { kind: 'status', status };
          logger.warn({ model, node: args.nodeName, status, err: (err as Error).message }, 'qwen: candidate failed');
          continue;
        }
        // Authoritative (bad key / quota / bad request) — surface it directly.
        throwMappedQwenError(err, status, model);
      }
    }

    if (responseText && responseText.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(responseText));
      } catch (err) {
        const preview = responseText.length > 800 ? `${responseText.slice(0, 800)}…` : responseText;
        lastFailure = { kind: 'parse', preview };
        logger.warn({ node: args.nodeName, err: (err as Error).message, preview }, 'qwen: response was not valid JSON');
        continue;
      }

      const validation = args.schema.safeParse(parsed);
      if (validation.success) return validation.data;
      const preview = responseText.length > 800 ? `${responseText.slice(0, 800)}…` : responseText;
      lastFailure = { kind: 'schema', preview };
      logger.warn(
        { node: args.nodeName, issues: validation.error.issues, preview },
        'qwen: response failed schema validation',
      );
      continue;
    }

    if (!responseText) {
      lastFailure = { kind: 'model', preview: '' };
      break;
    }
    logger.warn({ node: args.nodeName }, 'qwen: empty response');
    lastFailure = { kind: 'model', preview: '' };
  }

  if (lastFailure?.kind === 'blocked') {
    throw serviceUnavailable(
      'Qwen (Groq) ne image se details nahi nikaali (content filter). Alag angle/photo try karein.',
    );
  }
  if (lastFailure?.kind === 'status') {
    if (lastFailure.status !== undefined && lastFailure.status >= 500) {
      throw serviceUnavailable('Groq server par problem aa gayi — thodi der baad try karein.');
    }
    throw serviceUnavailable('Qwen se connect nahi ho paya — internet/network check karein aur dobara try karein.');
  }
  if (lastFailure?.kind === 'model') {
    if (!responseText) {
      throw serviceUnavailable('Qwen model available nahi hai — Groq console mein model enable karein (qwen/qwen3.8-27b) ya QWEN_MODEL set karein.');
    }
    throw serviceUnavailable('Qwen ka jawab khaali tha — dobara try karein.');
  }
  if (lastFailure?.kind === 'parse') {
    throw serviceUnavailable('Qwen response samajh nahi aaya — dobara try karein.');
  }
  if (lastFailure?.kind === 'schema') {
    throw serviceUnavailable('Qwen response sahi format mein nahi tha — dobara try karein.');
  }
  throw serviceUnavailable('Qwen ka jawab sahi nahi aaya — dobara try karein.');
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