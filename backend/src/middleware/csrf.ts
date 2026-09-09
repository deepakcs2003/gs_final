import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

/**
 * Signed double-submit CSRF.
 *
 * The cookie is readable by our own JavaScript (it must be, so the SPA can echo
 * it back in a header) but an attacker's page on another origin can neither
 * read it nor forge a valid signature. Verification requires both:
 *   1. header === cookie, compared in constant time, and
 *   2. the cookie's HMAC signature is ours.
 *
 * The webhook route is exempt: it carries no cookies and is authenticated by
 * Razorpay's own signature instead.
 */

const COOKIE_NAME = 'gs_csrf';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_BYTES = 32;

function sign(value: string): string {
  return crypto.createHmac('sha256', env.CSRF_SECRET).update(value).digest('base64url');
}

function issueToken(): string {
  const value = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return `${value}.${sign(value)}`;
}

function isWellFormed(token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const value = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(value);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function equalTokens(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const cookieBaseOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

/** Hands every visitor a CSRF token so the first write already has one. */
export function csrfIssue(req: Request, res: Response, next: NextFunction): void {
  const existing = req.cookies?.[COOKIE_NAME];
  if (typeof existing !== 'string' || !isWellFormed(existing)) {
    res.cookie(COOKIE_NAME, issueToken(), {
      ...cookieBaseOptions,
      httpOnly: false, // the SPA must read this to echo it back
      maxAge: 12 * 60 * 60 * 1000,
    });
  }
  next();
}

export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerRaw = req.get(HEADER_NAME);

  if (typeof cookieToken !== 'string' || typeof headerRaw !== 'string' || !headerRaw) {
    next(forbidden('Session expire ho gaya. Page refresh karke dobara try karein.'));
    return;
  }

  if (!isWellFormed(cookieToken) || !equalTokens(cookieToken, headerRaw)) {
    next(forbidden('Session expire ho gaya. Page refresh karke dobara try karein.'));
    return;
  }

  next();
}

export const csrfCookieName = COOKIE_NAME;
