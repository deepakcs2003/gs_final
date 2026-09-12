import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if
 * anything required is missing or weak. Failing closed here is deliberate: a
 * half-configured server is worse than one that never accepts traffic.
 *
 * Values are never logged — only the *names* of failing keys.
 */
const csvToArray = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    APP_BASE_URL: z.string().url(),
    API_BASE_URL: z.string().url(),
    CORS_ORIGINS: z.string().min(1).transform(csvToArray),

    MONGODB_URI: z
      .string()
      .min(1)
      .refine(
        (uri) => uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'),
        'must be a mongodb:// or mongodb+srv:// connection string',
      ),

    // 32 chars is the floor; the .env.example generator emits 64.
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),
    COOKIE_DOMAIN: z.string().optional(),
    // Directory of the built SPA (frontend/dist). In production the API server
    // serves the static files too, so the app lives on one origin and cookies
    // stay first-party. Empty string disables SPA hosting (API-only).
    PUBLIC_DIR: z.string().default(''),

    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    CLOUDINARY_CLOUD_NAME: z.string().default(''),
    CLOUDINARY_API_KEY: z.string().default(''),
    CLOUDINARY_API_SECRET: z.string().default(''),
    CLOUDINARY_UPLOAD_FOLDER: z.string().default('guddi-silai'),

    // WhatsApp Business Cloud API — direct Meta integration (no third-party
    // BSP). OTPs, order notifications and campaigns are delivered here.
    //
    // Credentials are MODE-SCOPED: test and production each carry their own
    // phone number id / business account id / access token, and the active one
    // is selected by WHATSAPP_MODE (default "test"). There is deliberately NO
    // fallback from production credentials to test credentials.
    WHATSAPP_ENABLED: z.string().default('true'),
    WHATSAPP_MODE: z.enum(['test', 'production']).default('test'),
    WHATSAPP_TEST_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_TEST_BUSINESS_ACCOUNT_ID: z.string().default(''),
    WHATSAPP_TEST_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_PRODUCTION_BUSINESS_ACCOUNT_ID: z.string().default(''),
    WHATSAPP_PRODUCTION_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().default(''),
    WHATSAPP_APP_SECRET: z.string().default(''),
    // Comma-separated Meta "test" numbers allowed while WHATSAPP_MODE=test.
    WHATSAPP_TEST_NUMBERS: z.string().default(''),
    WHATSAPP_API_VERSION: z.string().default('v25.0'),

    SHIPROCKET_EMAIL: z.string().default(''),
    SHIPROCKET_PASSWORD: z.string().default(''),
    SHIPROCKET_PICKUP_LOCATION: z.string().default('Primary'),
    SHIPROCKET_BASE_URL: z.string().url().default('https://apiv2.shiprocket.in/v1/external'),
    // 'true' simulates Shiprocket locally (no network). Anything else keeps the
    // default behaviour: ON outside production, OFF in production (see below).
    SHIPROCKET_MOCK: z.string().default(''),

    GOOGLE_CLIENT_ID: z.string().default(''),
    // Comma-separated Google emails that become SUPER_ADMIN automatically when
    // they sign in with Google. e.g. "guddi7709894512@gmail.com"
    GOOGLE_ADMIN_EMAILS: z.string().default(''),

    // Groq API key — used only server-side for the admin "Generate with Qwen"
    // product helper. Never exposed to the browser.
    GROQ_API_KEY: z.string().default(''),
    // Optional: override the multimodal Qwen model served by Groq (defaults to
    // qwen/qwen3.8-27b). Admins must enable the model on their Groq console.
    QWEN_MODEL: z.string().default(''),
    // Official Groq OpenAI-compatible base URL (the default is fine).
    GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),

    // Google Gemini free tier — the PRIMARY vision provider for the admin
    // "Generate with Qwen" helper (free, cloud-hosted, no server RAM needed).
    // Give GEMINI_API_KEY from https://aistudio.google.com/apikey. If it's set,
    // Gemini is used; otherwise the backend falls back to Groq.
    GEMINI_API_KEY: z.string().default(''),
    // Free-tier model. gemini-2.5-flash = best quality; gemini-2.5-flash-lite
    // has much higher free daily limits. Both see up to 8 images per request.
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),

    WHATSAPP_NUMBER: z.string().regex(/^\d{10,15}$/, 'digits only, with country code').default('919999999999'),
    CALL_NUMBER: z.string().regex(/^\d{10,15}$/, 'digits only, with country code').default('919999999999'),
    ADMIN_MOBILE: z.string().regex(/^\d{10,15}$/, 'digits only, with country code').optional(),
    USD_RATE_INR: z.coerce.number().positive().default(88),
    SHIPPING_FLAT_INR: z.coerce.number().int().nonnegative().default(79),
    FREE_SHIPPING_ABOVE_INR: z.coerce.number().int().nonnegative().default(1499),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;

    // Production must not run on placeholder secrets or a mocked SMS provider.
    const required: Array<[string, string]> = [
      ['RAZORPAY_KEY_ID', cfg.RAZORPAY_KEY_ID],
      ['RAZORPAY_KEY_SECRET', cfg.RAZORPAY_KEY_SECRET],
      ['RAZORPAY_WEBHOOK_SECRET', cfg.RAZORPAY_WEBHOOK_SECRET],
    ];
    for (const [key, value] of required) {
      if (!value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'is required in production' });
      }
    }

    // Test-mode Razorpay keys would silently collect nothing in production.
    if (cfg.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_KEY_ID'],
        message: 'is a test-mode key — a live rzp_live_ key is required in production',
      });
    }

    // Base URLs / CORS must point at the real public host in production.
    for (const [key, value] of [
      ['APP_BASE_URL', cfg.APP_BASE_URL],
      ['API_BASE_URL', cfg.API_BASE_URL],
    ] as const) {
      if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'must point to the public production host, not localhost',
        });
      }
    }
    if (['http:', 'ws:'].includes(new URL(cfg.APP_BASE_URL).protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BASE_URL'],
        message: 'must use https in production',
      });
    }
    if (cfg.CORS_ORIGINS.some((origin) => /https?:\/\/(localhost|127\.0\.0\.1)/.test(origin))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'must contain only the public production origins (no localhost)',
      });
    }
    // WhatsApp is the single OTP + notification channel. Production must
    // actually be configured, and must be talking to live numbers (no test
    // mode — otherwise real customers could never receive an OTP or an order
    // update). That is the deliberate TEST → PRODUCTION switch.
    if (!cfg.WHATSAPP_ENABLED || cfg.WHATSAPP_ENABLED.toLowerCase() === 'false') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_ENABLED'],
        message: 'WhatsApp is the OTP + notification channel and must be enabled in production',
      });
    }
    if (cfg.WHATSAPP_MODE !== 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_MODE'],
        message: 'must be "production" in production — test mode only messages Meta test numbers',
      });
    }
    // Production mode NEVER falls back to test credentials. If production
    // credentials are missing, name the exact variables so the operator knows
    // what to fill in.
    if (cfg.WHATSAPP_MODE === 'production') {
      const productionRequired: Array<[string, string]> = [
        ['WHATSAPP_PRODUCTION_PHONE_NUMBER_ID', cfg.WHATSAPP_PRODUCTION_PHONE_NUMBER_ID],
        ['WHATSAPP_PRODUCTION_BUSINESS_ACCOUNT_ID', cfg.WHATSAPP_PRODUCTION_BUSINESS_ACCOUNT_ID],
        ['WHATSAPP_PRODUCTION_ACCESS_TOKEN', cfg.WHATSAPP_PRODUCTION_ACCESS_TOKEN],
      ];
      for (const [key, value] of productionRequired) {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'is required while WHATSAPP_MODE=production — test credentials are never used as a fallback',
          });
        }
      }
      // Webhook delivery status requires the app secret to verify signatures.
      if (!cfg.WHATSAPP_APP_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_APP_SECRET'],
          message: 'is required in production — the webhook X-Hub-Signature-256 cannot be verified without it',
        });
      }
    }
    if (cfg.JWT_SECRET === cfg.CSRF_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CSRF_SECRET'],
        message: 'must differ from JWT_SECRET',
      });
    }
    if (cfg.SHIPROCKET_MOCK === 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHIPROCKET_MOCK'],
        message: 'cannot be "true" in production — mock Shiprocket would fake real orders',
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Print key names and rules only. Never the offending values.
  const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  console.error(`\nInvalid environment configuration:\n${problems.join('\n')}\n\nSee backend/.env.example.\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

/**
 * Mock mode simulates Shiprocket entirely in-process on a fresh checkout.
 * Explicit 'true' always mocks; explicit 'false' never mocks; unset means ON
 * outside production (safe by default) and OFF in production (never fake).
 */
export const shiprocketMock: boolean =
  env.SHIPROCKET_MOCK === 'true' || (env.SHIPROCKET_MOCK !== 'false' && env.NODE_ENV !== 'production');

/* -------------------------------------------------------------------------- */
/* WhatsApp credential selection (single source of truth)                      */
/* -------------------------------------------------------------------------- */

/**
 * The ACTIVE WhatsApp configuration. WHATSAPP_MODE decides which credential
 * set is used — test or production. There is NO fallback: production mode with
 * missing production credentials is a boot failure (see superRefine above),
 * never a silent swap to test numbers.
 */
export interface WhatsAppConfig {
  mode: 'test' | 'production';
  enabled: boolean;
  /** Active phone number ID — the TEST or PRODUCTION one, never both. */
  phoneNumberId: string;
  /** Active business account ID for the selected mode. */
  businessAccountId: string;
  /** Active access token for the selected mode. */
  accessToken: string;
  /** Our own secret echoed back on webhook GET verification. */
  verifyToken: string;
  /** Meta app secret — HMAC key for webhook POST signature checks. */
  appSecret: string;
  /** Graph API version, e.g. "v25.0". */
  apiVersion: string;
  /** Numbers reachable while mode = test (empty = rely on Meta's allow-list). */
  testNumbers: string[];
  /** True when the active mode has enough credentials to call the API. */
  configured: boolean;
}

const waMode = env.WHATSAPP_MODE;
const activeCredentials =
  waMode === 'production'
    ? {
        phoneNumberId: env.WHATSAPP_PRODUCTION_PHONE_NUMBER_ID,
        businessAccountId: env.WHATSAPP_PRODUCTION_BUSINESS_ACCOUNT_ID,
        accessToken: env.WHATSAPP_PRODUCTION_ACCESS_TOKEN,
      }
    : {
        phoneNumberId: env.WHATSAPP_TEST_PHONE_NUMBER_ID,
        businessAccountId: env.WHATSAPP_TEST_BUSINESS_ACCOUNT_ID,
        accessToken: env.WHATSAPP_TEST_ACCESS_TOKEN,
      };
const waEnabled = env.WHATSAPP_ENABLED.trim().toLowerCase() !== 'false';

/** Active WhatsApp configuration — the only object the client/services read. */
export const whatsapp: WhatsAppConfig = {
  mode: waMode,
  enabled: waEnabled,
  phoneNumberId: activeCredentials.phoneNumberId,
  businessAccountId: activeCredentials.businessAccountId,
  accessToken: activeCredentials.accessToken,
  verifyToken: env.WHATSAPP_VERIFY_TOKEN,
  appSecret: env.WHATSAPP_APP_SECRET,
  apiVersion: env.WHATSAPP_API_VERSION,
  testNumbers: env.WHATSAPP_TEST_NUMBERS.split(',')
    .map((n) => n.trim())
    .filter(Boolean),
  configured: Boolean(activeCredentials.phoneNumberId && activeCredentials.accessToken),
};

/** Google emails that get SUPER_ADMIN on sign-in (lowercased, comma-separated). */
export const googleAdminEmails: string[] = env.GOOGLE_ADMIN_EMAILS.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** True when the integration has enough configuration to be usable. */
export const integrations = {
  razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  razorpayWebhook: Boolean(env.RAZORPAY_WEBHOOK_SECRET),
  cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
  shiprocket: Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD),
  google: Boolean(env.GOOGLE_CLIENT_ID),
  qwen: Boolean(env.GROQ_API_KEY || env.GEMINI_API_KEY),
  whatsapp: whatsapp.enabled && whatsapp.configured,
} as const;
