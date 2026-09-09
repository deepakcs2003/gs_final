import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';
import { badRequest } from '../utils/errors.js';

/**
 * Every request payload is bound through an explicit schema. Two rules matter:
 *
 *  1. Schemas are `.strict()` at the call site, so unknown keys are rejected
 *     rather than ignored — this is what stops mass-assignment (a client
 *     sneaking `adminRoles` or `sellingPriceInr` into a body).
 *  2. Handlers read from `req.validated`, never from the raw body/query. The
 *     parsed value is typed and consists only of primitives we asked for, so no
 *     Mongo operator object (`{$ne: null}`) can ever reach a query.
 */

export interface ValidatedRequest<B = unknown, Q = unknown, P = unknown> extends Request {
  validated: { body: B; query: Q; params: P };
}

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'value';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated = {
        body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
        query: schemas.query ? schemas.query.parse(req.query ?? {}) : undefined,
        params: schemas.params ? schemas.params.parse(req.params ?? {}) : undefined,
      };
      (req as ValidatedRequest).validated = validated as ValidatedRequest['validated'];
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Field-level messages are safe to return: they describe our own schema,
        // not server internals.
        next(badRequest('Kuch details sahi nahi hain. Please check karein.', fieldErrors(err)));
        return;
      }
      next(err);
    }
  };
}

/** Reads the validated payload with the schema's inferred type. */
export function payload<S extends Schemas>(req: Request) {
  return (req as ValidatedRequest).validated as {
    body: S['body'] extends ZodTypeAny ? ZodInfer<S['body']> : undefined;
    query: S['query'] extends ZodTypeAny ? ZodInfer<S['query']> : undefined;
    params: S['params'] extends ZodTypeAny ? ZodInfer<S['params']> : undefined;
  };
}
