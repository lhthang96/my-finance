// Thin fetch wrapper for /api: same-origin cookies, JSON in and out, errors as ApiError.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called whenever an authenticated request answers 401 (the app then shows the login screen). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** True for failures where the request never got an answer (offline, server unreachable). */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined;
    const message = typeof err === 'string' ? err : res.statusText || `HTTP ${res.status}`;
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  return data as T;
}
