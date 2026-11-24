// Passcode check, signed session cookie (HMAC-SHA256 via WebCrypto) and login rate limiting.

export const SESSION_COOKIE = 'mf_session';
export const SESSION_MAX_AGE_S = 31536000; // one year
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function makeSessionToken(secret: string, expMs: number): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ exp: expMs })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload) as BufferSource);
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(secret: string, token: string, nowMs: number): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      b64urlDecode(sig) as BufferSource,
      enc.encode(payload) as BufferSource,
    );
    if (!ok) return false;
    const data = JSON.parse(dec.decode(b64urlDecode(payload))) as { exp?: unknown };
    return typeof data.exp === 'number' && data.exp > nowMs;
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** True for plain-http localhost requests, where the Secure cookie flag is omitted. */
export function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function cookieAttributes(url: URL, maxAge: number): string {
  const secure = isLocalHttp(url) ? '' : 'Secure; ';
  return `HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function isAuthenticated(request: Request, env: Env, nowMs = Date.now()): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  return verifySessionToken(env.SESSION_SECRET, token, nowMs);
}
