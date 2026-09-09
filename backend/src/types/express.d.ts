import type { AdminRole } from '../domain/constants.js';

declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      adminRoles: AdminRole[];
    }

    interface Request {
      /** Present only after a valid access token has been verified. */
      auth?: AuthContext;
      /** Client-generated analytics session id, if the caller supplied one. */
      analyticsSessionId?: string;
      /** Raw body bytes, captured only on the Razorpay webhook route. */
      rawBody?: Buffer;
    }
  }
}

export {};
