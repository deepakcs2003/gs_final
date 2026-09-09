import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Yeh page ya API nahi mila.' },
  });
}

/**
 * Single exit point for every failure. Clients receive a stable code and a
 * customer-safe message; the specifics — stack, driver text, failing query —
 * stay in the server log. Leaking those would hand an attacker a map of the
 * schema and the stack.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Kuch technical problem aa gayi. Thodi der baad try karein.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.publicMessage;
    details = err.details;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Kuch details sahi nahi hain. Please check karein.';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_IDENTIFIER';
    message = 'Yeh item nahi mila.';
  } else if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'Yeh already exist karta hai.';
  }

  const logPayload = {
    err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : { message: String(err) },
    status,
    code,
    method: req.method,
    path: req.path,
    requestId: req.get('x-request-id') ?? undefined,
  };

  if (status >= 500) logger.error(logPayload, 'request failed');
  else logger.warn({ ...logPayload, err: { message: logPayload.err.message } }, 'request rejected');

  const body: Record<string, unknown> = { error: { code, message } };
  if (details !== undefined) (body.error as Record<string, unknown>).fields = details;
  // Stack traces only ever go to the log, never over the wire — not even in dev,
  // so behaviour is identical in every environment.
  if (!isProd && status >= 500) {
    (body.error as Record<string, unknown>).hint = 'Check the server log for details.';
  }

  res.status(status).json(body);
}
