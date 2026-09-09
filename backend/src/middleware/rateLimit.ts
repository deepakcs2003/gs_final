import rateLimit, { type Store, type ClientRateLimitInfo, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { RateLimitHit } from '../models/analytics.js';
import { logger } from '../utils/logger.js';
import { tooMany } from '../utils/errors.js';

/**
 * Mongo-backed store so limits hold across every API instance. The default
 * in-memory store would let an attacker simply spread requests over replicas.
 *
 * On a database error we return a hit count above any configured limit, which
 * makes the limiter reject: failing closed is the right call for a limiter that
 * guards OTP sending and payment creation.
 */
class MongoRateLimitStore implements Store {
  // Public because `implements Store` compares structurally — private members
  // would make the class unassignable to the interface.
  windowMs = 60_000;
  readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string) {
    return `${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const _id = this.id(key);

    try {
      // Bump an active window if one exists.
      const active = await RateLimitHit.findOneAndUpdate(
        { _id, expiresAt: { $gt: now } },
        { $inc: { hits: 1 } },
        { new: true },
      ).lean();

      if (active) {
        return { totalHits: active.hits ?? 1, resetTime: active.expiresAt };
      }

      // No active window: start a fresh one.
      const expiresAt = new Date(now.getTime() + this.windowMs);
      const started = await RateLimitHit.findOneAndUpdate(
        { _id },
        { $set: { hits: 1, expiresAt } },
        { new: true, upsert: true },
      ).lean();

      return { totalHits: started?.hits ?? 1, resetTime: started?.expiresAt ?? expiresAt };
    } catch (err) {
      logger.error({ err: (err as Error).message, prefix: this.prefix }, 'rate limit store failure — failing closed');
      return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now.getTime() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await RateLimitHit.updateOne({ _id: this.id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    } catch {
      /* best-effort only */
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await RateLimitHit.deleteOne({ _id: this.id(key) });
    } catch {
      /* best-effort only */
    }
  }
}

const reject = (_req: Request, _res: Response, next: (err: unknown) => void) => {
  next(tooMany());
};

interface LimiterSpec {
  prefix: string;
  windowMs: number;
  limit: number;
  /** Extra dimension beyond IP — user id, mobile number, etc. (README §63). */
  keyBy?: (req: Request) => string;
  message?: string;
}

function makeLimiter({ prefix, windowMs, limit, keyBy, message }: LimiterSpec) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoRateLimitStore(prefix),
    keyGenerator: (req) => {
      const ip = req.ip ?? 'unknown';
      const extra = keyBy ? keyBy(req) : '';
      return extra ? `${ip}|${extra}` : ip;
    },
    handler: (req, res, next) => {
      logger.warn({ prefix, path: req.path }, 'rate limit tripped');
      next(message ? tooMany(message) : tooMany());
    },
    skipFailedRequests: false,
  });
}

/** Broad ceiling for ordinary browsing. */
export const generalLimiter = makeLimiter({ prefix: 'gen', windowMs: 60_000, limit: 300 });

/** Reads are cheap but still bounded. */
export const readLimiter = makeLimiter({ prefix: 'read', windowMs: 60_000, limit: 200 });

/** Writes that create or mutate customer state. */
export const writeLimiter = makeLimiter({ prefix: 'write', windowMs: 60_000, limit: 40 });

/**
 * OTP send is the most abusable endpoint on the site: it costs money per call
 * and can be used to harass a phone number. Limited per IP *and* per mobile.
 */
export const otpSendLimiter = makeLimiter({
  prefix: 'otp-send',
  windowMs: 15 * 60_000,
  limit: 5,
  keyBy: (req) => String((req.body as { mobile?: unknown } | undefined)?.mobile ?? ''),
  message: 'Bahut baar OTP maanga gaya. 15 minute baad try karein.',
});

export const otpVerifyLimiter = makeLimiter({
  prefix: 'otp-verify',
  windowMs: 15 * 60_000,
  limit: 10,
  keyBy: (req) => String((req.body as { mobile?: unknown } | undefined)?.mobile ?? ''),
  message: 'Bahut baar galat OTP. 15 minute baad try karein.',
});

/** Order + payment creation. Deliberately tight. */
export const checkoutLimiter = makeLimiter({
  prefix: 'checkout',
  windowMs: 10 * 60_000,
  limit: 15,
  keyBy: (req) => req.auth?.userId ?? '',
});

/** Analytics beacons are frequent by nature but must not become a DoS vector. */
export const analyticsLimiter = makeLimiter({ prefix: 'evt', windowMs: 60_000, limit: 120 });

export const searchLimiter = makeLimiter({ prefix: 'search', windowMs: 60_000, limit: 60 });

export { reject };
