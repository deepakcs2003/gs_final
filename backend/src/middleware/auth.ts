import type { NextFunction, Request, Response } from 'express';
import { cookieNames, verifyAccessToken } from '../services/tokens.js';
import { User } from '../models/user.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { AdminRole } from '../domain/constants.js';

/**
 * Optional authentication. The whole storefront works signed-out (README §2),
 * so this never rejects — it only enriches the request when a valid token is
 * present.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[cookieNames.access];
  if (typeof token === 'string' && token) {
    const claims = verifyAccessToken(token);
    if (claims) {
      req.auth = { userId: claims.sub, adminRoles: claims.roles };
    }
  }

  const sessionHeader = req.get('x-session-id');
  if (typeof sessionHeader === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(sessionHeader)) {
    req.analyticsSessionId = sessionHeader;
  }

  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  next();
}

/**
 * Roles come from the signed token, but a blocked or demoted account must lose
 * access immediately rather than at token expiry — so admin checks re-read the
 * user. Customers are not re-read; a 30-minute stale window is acceptable there
 * and would otherwise cost a query on every request.
 */
export function requireAdmin(...allowed: AdminRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }

    const user = await User.findById(req.auth.userId).select('adminRoles isBlocked').lean();
    if (!user || user.isBlocked || !user.adminRoles?.length) {
      next(forbidden());
      return;
    }

    const roles = user.adminRoles as AdminRole[];
    const permitted = roles.includes('SUPER_ADMIN') || allowed.some((role) => roles.includes(role));
    if (!permitted) {
      next(forbidden());
      return;
    }

    req.auth.adminRoles = roles;
    next();
  };
}
