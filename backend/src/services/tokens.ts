import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { cookieBaseOptions } from '../middleware/csrf.js';
import { User } from '../models/user.js';
import type { AdminRole } from '../domain/constants.js';

/**
 * Two-token session.
 *
 *  - Access token: short-lived signed JWT in an httpOnly cookie. Never touches
 *    localStorage, so an XSS bug cannot read it out of the page.
 *  - Refresh token: opaque 32 random bytes, stored *hashed* on the user
 *    document and rotated on every use. A stolen database gives an attacker
 *    hashes, not sessions; a replayed old token no longer matches.
 */

const ACCESS_COOKIE = 'gs_at';
const REFRESH_COOKIE = 'gs_rt';
const ACCESS_TTL_SECONDS = 30 * 60; // 30 minutes
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ISSUER = 'guddi-silai';

export interface AccessTokenClaims {
  sub: string;
  roles: AdminRole[];
  /** Session generation — bumped on logout-all so old tokens die early. */
  sid: string;
}

export function signAccessToken(userId: string, roles: AdminRole[], sid: string): string {
  return jwt.sign({ roles, sid } satisfies Omit<AccessTokenClaims, 'sub'>, env.JWT_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: ISSUER,
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: ISSUER,
      // Pinning the algorithm blocks the "alg: none" and HS/RS confusion attacks.
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string' || !decoded.sub) return null;
    const roles = Array.isArray(decoded.roles) ? (decoded.roles as AdminRole[]) : [];
    return { sub: String(decoded.sub), roles, sid: String(decoded.sid ?? '') };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) };
}

/** SHA-256 is right here: the token already has 256 bits of entropy, so there
 *  is nothing to brute-force and no need for a slow KDF. */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieBaseOptions,
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieBaseOptions,
    // Scoped so the long-lived credential is only ever sent to the refresh route.
    path: '/api/auth/refresh',
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBaseOptions });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBaseOptions, path: '/api/auth/refresh' });
}

/**
 * Issues a fresh session. Called on login and on every refresh, which rotates
 * the session id — this is what defeats session fixation.
 */
export async function issueSession(
  res: Response,
  userId: string,
  roles: AdminRole[],
  userAgent: string,
): Promise<void> {
  const sid = crypto.randomBytes(12).toString('base64url');
  const refresh = generateRefreshToken();
  const userAgentHash = crypto.createHash('sha256').update(userAgent || '').digest('hex').slice(0, 32);

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        refreshTokens: {
          $each: [{ hash: refresh.hash, expiresAt: refresh.expiresAt, createdAt: new Date(), userAgentHash }],
          // Cap concurrent sessions; oldest fall off.
          $slice: -5,
        },
      },
      $set: { lastLoginAt: new Date() },
    },
  );

  setAuthCookies(res, signAccessToken(userId, roles, sid), refresh.token);
}

export async function revokeRefreshToken(userId: string, token: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $pull: { refreshTokens: { hash: hashRefreshToken(token) } } });
}

export const cookieNames = { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE } as const;
