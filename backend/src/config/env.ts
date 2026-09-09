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

    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    CLOUDINARY_CLOUD_NAME: z.string().default(''),
    CLOUDINARY_API_KEY: z.string().default(''),
    CLOUDINARY_API_SECRET: z.string().default(''),
    CLOUDINARY_UPLOAD_FOLDER: z.string().default('guddi-silai'),

    SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
    MSG91_AUTH_KEY: z.string().default(''),
    MSG91_SENDER_ID: z.string().default('GUDDIS'),
    MSG91_OTP_TEMPLATE_ID: z.string().default(''),

    SHIPROCKET_EMAIL: z.string().default(''),
    SHIPROCKET_PASSWORD: z.string().default(''),
    SHIPROCKET_PICKUP_LOCATION: z.string().default('Primary'),
    SHIPROCKET_BASE_URL: z.string().url().default('https://apiv2.shiprocket.in/v1/external'),
    // 'true' simulates Shiprocket locally (no network). Anything else keeps the
    // default behaviour: ON outside production, OFF in production (see below).
    SHIPROCKET_MOCK: z.string().default(''),

    GOOGLE_CLIENT_ID: z.string().default(''),

    // Groq API key — used only server-side for the admin "Generate with Qwen"
    // product helper. Never exposed to the browser.
    GROQ_API_KEY: z.string().default(''),
    // Optional: override the multimodal Qwen model served by Groq (defaults to
    // qwen/qwen3.8-27b). Admins must enable the model on their Groq console.
    QWEN_MODEL: z.string().default(''),
    // Official Groq OpenAI-compatible base URL (the default is fine).
    GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),

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
    if (cfg.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message: 'cannot be "console" in production — OTPs would never be delivered',
      });
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

/** True when the integration has enough configuration to be usable. */
export const integrations = {
  razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  razorpayWebhook: Boolean(env.RAZORPAY_WEBHOOK_SECRET),
  cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
  shiprocket: Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD),
  google: Boolean(env.GOOGLE_CLIENT_ID),
  qwen: Boolean(env.GROQ_API_KEY),
  msg91: Boolean(env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID),
} as const;
