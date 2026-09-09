/**
 * Errors carry two messages: a `publicMessage` safe to show a customer (in
 * plain Hinglish where useful) and the internal `message` for server logs.
 * Handlers should never leak stack traces, driver errors or validation
 * internals to the client — errorHandler enforces that.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(status: number, code: string, publicMessage: string, options?: { details?: unknown; cause?: unknown }) {
    super(`${code}: ${publicMessage}`);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.details = options?.details;
    if (options?.cause) this.cause = options.cause;
  }
}

export const badRequest = (msg = 'Request sahi nahi hai.', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, { details });

export const unauthorized = (msg = 'Pehle login karein.') => new AppError(401, 'UNAUTHORIZED', msg);

export const forbidden = (msg = 'Aapko iski permission nahi hai.') => new AppError(403, 'FORBIDDEN', msg);

export const notFound = (msg = 'Yeh item nahi mila.') => new AppError(404, 'NOT_FOUND', msg);

export const conflict = (msg = 'Yeh already exist karta hai.') => new AppError(409, 'CONFLICT', msg);

export const tooMany = (msg = 'Bahut zyada requests. Thodi der baad try karein.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);

export const serviceUnavailable = (msg = 'Service abhi available nahi hai. Thodi der baad try karein.') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', msg);
