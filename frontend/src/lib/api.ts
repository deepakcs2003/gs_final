/**
 * Thin API client.
 *
 * Two things it always does:
 *  - sends cookies (`credentials: 'include'`), because the session lives in an
 *    httpOnly cookie rather than in localStorage where a script could read it;
 *  - echoes the CSRF cookie back in a header on every state-changing call.
 */

const CSRF_COOKIE = 'gs_csrf';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/** Stable per-browser id used only to group analytics events (README §76). */
export function getSessionId(): string {
  const KEY = 'gs_session_id';
  let id = '';
  try {
    id = localStorage.getItem(KEY) ?? '';
  } catch {
    /* private mode — fall through to an in-memory id */
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 22);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Suppresses the shared error toast for calls that handle failure inline. */
  quiet?: boolean;
  /** Internal: the refresh call itself must never trigger another refresh. */
  noAuthRetry?: boolean;
}

/** Single shared pending refresh, so a burst of 401s triggers one call, not ten. */
let pendingRefresh: Promise<void> | null = null;

async function refreshSession(): Promise<void> {
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      try {
        await api('/auth/refresh', { method: 'POST', noAuthRetry: true });
      } catch {
        // Refresh failed (expired/absent refresh cookie) — the caller rethrows
        // its own original error.
      }
    })().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';

  const perform = (): Promise<Response> => {
    const headers: Record<string, string> = { 'X-Session-Id': getSessionId() };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = readCookie(CSRF_COOKIE);
    return fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  };

  let response = await perform();

  // A fresh 401 usually means the 30-minute access token aged out mid-session
  // (e.g. while filling a long admin form). Refresh once silently and retry.
  // Without this, an admin who is visibly logged in gets "Pehle login karein"
  // on the first save after expiry.
  if (response.status === 401 && !options.noAuthRetry) {
    await refreshSession();
    response = await perform();
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Kuch problem aa gayi. Thodi der baad try karein.',
      error?.fields,
      payload,
    );
  }

  return payload as T;
}

/**
 * The access-token refresh described above is now built into `api()`, so this
 * wrapper is just a compatibility alias — every call site already auto-refreshes.
 */
export async function apiWithRefresh<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return api<T>(path, options);
}

export interface UploadedFile {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

/**
 * Uploads image files as multipart/form-data. The generic `api()` helper can't
 * be used here — it always JSON-stringifies the body.
 */
export async function uploadImages(files: File[]): Promise<UploadedFile[]> {
  if (files.length === 0) return [];

  const form = new FormData();
  for (const file of files) form.append('files', file);

  const headers: Record<string, string> = {
    'X-Session-Id': getSessionId(),
    'X-CSRF-Token': readCookie(CSRF_COOKIE),
  };

  const perform = (): Promise<Response> =>
    fetch('/api/admin/upload', { method: 'POST', headers, credentials: 'include', body: form });

  let response = await perform();
  if (response.status === 401) {
    await refreshSession();
    response = await perform();
  }

  let payload: { files?: UploadedFile[]; error?: { code?: string; message?: string } } = {};
  try { payload = await response.json() as typeof payload; } catch { payload = {}; }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'UPLOAD_FAILED',
      payload.error?.message ?? 'Image upload nahi hua. Thodi der baad try karein.',
    );
  }

  return payload.files ?? [];
}

export async function uploadOurWorkImages(files: File[]): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const headers: Record<string, string> = { 'X-Session-Id': getSessionId() };
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch('/api/our-work/upload', { method: 'POST', headers, credentials: 'include', body: form });
  const payload = await response.json() as { files?: UploadedFile[]; error?: { message?: string } };
  if (!response.ok) throw new ApiError(response.status, 'UPLOAD_FAILED', payload.error?.message ?? 'Image upload nahi hua.');
  return payload.files ?? [];
}
