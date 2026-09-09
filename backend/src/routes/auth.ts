import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { User } from '../models/user.js';
import { OtpToken } from '../models/user.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { otpSendLimiter, otpVerifyLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { clearAuthCookies, cookieNames, hashRefreshToken, issueSession, revokeRefreshToken } from '../services/tokens.js';
import { getSmsProvider, maskMobile } from '../services/sms/index.js';
import { hashIp } from '../services/geo.js';
import { env, integrations, isDev } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { badRequest, serviceUnavailable, unauthorized } from '../utils/errors.js';
import type { AdminRole } from '../domain/constants.js';

const router = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const BCRYPT_COST = 12;

/**
 * Mobile numbers are normalised to digits with a country code so the same
 * person always maps to the same account. Bare 10-digit input is assumed to be
 * Indian, which is the overwhelming majority of this shop's customers.
 */
const mobileSchema = z
  .string()
  .trim()
  .max(20)
  .transform((raw) => raw.replace(/[\s()-]/g, '').replace(/^\+/, ''))
  .refine((v) => /^\d{10,15}$/.test(v), 'Sahi mobile number likhein.')
  .transform((v) => (v.length === 10 ? `91${v}` : v))
  .refine((v) => !(v.startsWith('91') && v.length === 12) || /^91[6-9]\d{9}$/.test(v), 'Sahi mobile number likhein.');

/* -------------------------------------------------------------------------- */
/* POST /api/auth/otp/send                                                     */
/* -------------------------------------------------------------------------- */

const sendOtpSchema = z.object({ mobile: mobileSchema }).strict();

router.post('/otp/send', otpSendLimiter, validate({ body: sendOtpSchema }), async (req: Request, res: Response) => {
  const { mobile } = (req as Request & { validated: { body: { mobile: string } } }).validated.body;

  // 6 digits from a CSPRNG. Math.random() would be predictable from a few
  // observed codes and is never acceptable for a credential.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);

  // Any earlier code for this number stops working the moment a new one is
  // sent, so a user cannot accumulate a pool of valid codes.
  await OtpToken.updateMany({ mobile, consumedAt: null }, { $set: { consumedAt: new Date() } });

  await OtpToken.create({
    mobile,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    ipHash: hashIp(req.ip),
  });

  try {
    await getSmsProvider().sendOtp(mobile, code);
  } catch (err) {
    logger.error({ err: (err as Error).message, mobile: maskMobile(mobile) }, 'otp delivery failed');
    throw serviceUnavailable('OTP bhejne mein problem aayi. Thodi der baad try karein.');
  }

  res.json({
    ok: true,
    message: `OTP ${maskMobile(mobile)} par bhej diya gaya hai.`,
    expiresInSeconds: OTP_TTL_MS / 1000,
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/otp/verify                                                   */
/* -------------------------------------------------------------------------- */

const verifyOtpSchema = z
  .object({
    mobile: mobileSchema,
    code: z.string().trim().regex(/^\d{6}$/, 'OTP 6 digit ka hota hai.'),
    name: z.string().trim().max(80).optional(),
  })
  .strict();

router.post(
  '/otp/verify',
  otpVerifyLimiter,
  validate({ body: verifyOtpSchema }),
  async (req: Request, res: Response) => {
    const { mobile, code, name } = (req as Request & { validated: { body: z.infer<typeof verifyOtpSchema> } }).validated
      .body;

    const token = await OtpToken.findOne({ mobile, consumedAt: null, expiresAt: { $gt: new Date() } }).sort({
      createdAt: -1,
    });

    // One message for every failure mode. Distinguishing "no such code" from
    // "wrong code" would tell an attacker which numbers are mid-login.
    const genericFailure = unauthorized('OTP galat hai ya expire ho gaya. Dobara try karein.');

    if (!token) throw genericFailure;

    if (token.attempts >= OTP_MAX_ATTEMPTS) {
      token.consumedAt = new Date();
      await token.save();
      throw genericFailure;
    }

    token.attempts += 1;
    await token.save();

    const matches = await bcrypt.compare(code, token.codeHash);
    if (!matches) throw genericFailure;

    token.consumedAt = new Date();
    await token.save();

    const mobileCandidates = mobile.startsWith('91') ? [mobile, mobile.slice(2)] : [mobile];
    let user = await User.findOne({ mobile: { $in: mobileCandidates } });
    if (!user) {
      try {
        user = await User.findOneAndUpdate(
          { mobile },
          { $set: { mobileVerified: true }, $setOnInsert: { mobile, name: name ?? '' } },
          { new: true, upsert: true },
        );
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        user = await User.findOne({ mobile: { $in: mobileCandidates } });
        if (!user) throw err;
      }
    } else {
      const update: Record<string, unknown> = { mobileVerified: true };
      if (name && !user.name) {
        user.name = name;
        update.name = name;
      }
      await User.updateOne({ _id: user._id }, { $set: update });
    }

    if (!user) throw unauthorized('Login nahi ho paya. Dobara OTP verify karein.');
    if (user.isBlocked) throw unauthorized('Yeh account block hai. Support se baat karein.');

    await issueSession(res, String(user._id), (user.adminRoles ?? []) as AdminRole[], req.get('user-agent') ?? '');

    res.json({ ok: true, user: publicUser(user) });
  },
);

/* -------------------------------------------------------------------------- */
/* POST /api/auth/google  (README §30)                                         */
/* -------------------------------------------------------------------------- */

const googleSchema = z.object({ credential: z.string().min(20).max(4096) }).strict();

let googleClient: OAuth2Client | null = null;

router.post('/google', writeLimiter, validate({ body: googleSchema }), async (req: Request, res: Response) => {
  if (!integrations.google) throw serviceUnavailable('Google login abhi available nahi hai.');

  const { credential } = (req as Request & { validated: { body: { credential: string } } }).validated.body;

  googleClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    // Verifies Google's signature and that the token was minted for *our*
    // client id — without the audience check, any Google token would log in.
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'google id token verification failed');
    throw unauthorized('Google login verify nahi ho paya.');
  }

  if (!payload?.sub || !payload.email_verified || !payload.email) {
    throw unauthorized('Google account verify nahi hua.');
  }

  const user = await User.findOneAndUpdate(
    { googleId: payload.sub },
    {
      $setOnInsert: { googleId: payload.sub, email: payload.email.toLowerCase() },
      $set: {
        emailVerified: true,
        ...(payload.name ? { name: payload.name.slice(0, 80) } : {}),
        ...(payload.picture ? { avatarUrl: payload.picture } : {}),
      },
    },
    { new: true, upsert: true },
  );

  if (user.isBlocked) throw unauthorized('Yeh account block hai. Support se baat karein.');

  await issueSession(res, String(user._id), (user.adminRoles ?? []) as AdminRole[], req.get('user-agent') ?? '');
  res.json({ ok: true, user: publicUser(user) });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/refresh — rotating refresh tokens                            */
/* -------------------------------------------------------------------------- */

router.post('/refresh', writeLimiter, async (req: Request, res: Response) => {
  const presented = req.cookies?.[cookieNames.refresh];
  if (typeof presented !== 'string' || !presented) throw unauthorized();

  const hash = hashRefreshToken(presented);
  const user = await User.findOne({ 'refreshTokens.hash': hash }).select('+refreshTokens adminRoles isBlocked');

  if (!user || user.isBlocked) {
    clearAuthCookies(res);
    throw unauthorized();
  }

  const stored = (user.refreshTokens ?? []).find((t) => t.hash === hash);
  if (!stored || stored.expiresAt < new Date()) {
    // Expired token: drop it so the array cannot grow unbounded.
    await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { hash } } });
    clearAuthCookies(res);
    throw unauthorized();
  }

  // Rotate: the presented token is retired before a new one is issued, so a
  // stolen copy is only usable until the legitimate client next refreshes.
  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { hash } } });
  await issueSession(res, String(user._id), (user.adminRoles ?? []) as AdminRole[], req.get('user-agent') ?? '');

  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/logout                                                       */
/* -------------------------------------------------------------------------- */

router.post('/logout', async (req: Request, res: Response) => {
  const presented = req.cookies?.[cookieNames.refresh];
  if (typeof presented === 'string' && presented && req.auth) {
    await revokeRefreshToken(req.auth.userId, presented);
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* GET /api/auth/me                                                            */
/* -------------------------------------------------------------------------- */

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId).lean();
  if (!user) throw unauthorized();
  res.json({ user: publicUser(user) });
});

/* -------------------------------------------------------------------------- */
/* PATCH /api/auth/me — name + saved addresses                                 */
/* -------------------------------------------------------------------------- */

const addressSchema = z
  .object({
    label: z.string().trim().max(30).default('Home'),
    name: z.string().trim().min(2).max(80),
    mobile: mobileSchema,
    line1: z.string().trim().min(4).max(160),
    line2: z.string().trim().max(160).default(''),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().min(2).max(60),
    pincode: z.string().trim().regex(/^\d{4,10}$/, 'Sahi pincode likhein.'),
    country: z.string().trim().length(2).toUpperCase().default('IN'),
    isDefault: z.boolean().default(false),
  })
  .strict();

const updateMeSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    lastSeenPath: z.string().trim().max(300).optional(),
    addresses: z.array(addressSchema).max(10).optional(),
  })
  .strict();

router.patch('/me', requireAuth, writeLimiter, validate({ body: updateMeSchema }), async (req: Request, res: Response) => {
  const body = (req as Request & { validated: { body: z.infer<typeof updateMeSchema> } }).validated.body;

  // Only these three paths are assignable. Roles, mobile and refresh tokens are
  // absent from the schema, so a crafted body cannot reach them.
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.lastSeenPath !== undefined) update.lastSeenPath = body.lastSeenPath;
  if (body.addresses !== undefined) update.addresses = body.addresses;

  const user = await User.findByIdAndUpdate(req.auth!.userId, { $set: update }, { new: true }).lean();
  if (!user) throw unauthorized();

  res.json({ user: publicUser(user) });
});

/* -------------------------------------------------------------------------- */

interface UserLike {
  _id: unknown;
  name?: string | null;
  mobile?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  adminRoles?: string[] | null;
  addresses?: unknown[] | null;
  lastSeenPath?: string | null;
}

/** Never returns password hashes, refresh tokens or internal flags. */
function publicUser(user: UserLike) {
  return {
    id: String(user._id),
    name: user.name ?? '',
    mobile: user.mobile ? maskMobile(user.mobile) : '',
    email: user.email ?? '',
    avatarUrl: user.avatarUrl ?? '',
    isAdmin: (user.adminRoles ?? []).length > 0,
    addresses: user.addresses ?? [],
    lastSeenPath: user.lastSeenPath ?? '',
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Dev-only helper so the login flow can be exercised without an SMS gateway. */
if (isDev) {
  router.get('/dev/hint', (_req: Request, res: Response) => {
    res.json({ hint: 'SMS_PROVIDER=console — the OTP is printed in the API server log.' });
  });
}

export default router;
