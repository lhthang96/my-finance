// Web Push: subscription endpoints, notification store, payload-less sends (RFC 8292 VAPID), latest/list endpoints.
import { z } from 'zod';
import { readSettings, all, first, insertRow, run } from './db';
import { createVapidJwt } from './vapid';
import { testMessage, type NotificationText } from './reminders-messages';
import type { Locale } from '../shared/types';

export interface NotificationInput extends NotificationText {
  kind: string;
}

export interface SendOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface SendResult {
  id: number;
  /** Push requests accepted by the push service. */
  sent: number;
  /** Subscriptions deleted because the push service answered 404 or 410. */
  removed: number;
  /** Requests that failed for other reasons (network error, 4xx/5xx). */
  failed: number;
  /** True when VAPID secrets are missing, so nothing was sent. The notification is still stored. */
  skipped: boolean;
}

interface NotificationRow {
  id: number;
  kind: string;
  title_en: string;
  body_en: string;
  title_vi: string;
  body_vi: string;
  url: string;
  created_at: string;
  read: number;
}

const TTL_SECONDS = 86400;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const subscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

const unsubscribeBody = z.object({ endpoint: z.string().url().max(2048) });

/** Shape sent to the client: title and body in the user's locale. */
function toClient(row: NotificationRow, locale: Locale) {
  const en = locale !== 'vi';
  return {
    id: row.id,
    kind: row.kind,
    title: en ? row.title_en : row.title_vi,
    body: en ? row.body_en : row.body_vi,
    url: row.url,
    created_at: row.created_at,
  };
}

/** Stores a notification row and returns its id. */
export async function storeNotification(env: Env, n: NotificationInput, now: Date): Promise<number> {
  return insertRow(env.DB, 'notifications', {
    kind: n.kind,
    title_en: n.title_en,
    body_en: n.body_en,
    title_vi: n.title_vi,
    body_vi: n.body_vi,
    url: n.url,
    created_at: now.toISOString(),
    read: 0,
  });
}

/**
 * Stores the notification, then sends a payload-less Web Push to every subscription.
 * Subscriptions the push service reports as gone (404/410) are deleted.
 * Without VAPID secrets nothing is sent, but the notification is still stored.
 */
export async function sendToAll(env: Env, notification: NotificationInput, opts: SendOptions = {}): Promise<SendResult> {
  const now = opts.now ?? new Date();
  const id = await storeNotification(env, notification, now);
  const result: SendResult = { id, sent: 0, removed: 0, failed: 0, skipped: false };

  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) {
    result.skipped = true;
    return result;
  }

  const fetchImpl = opts.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const subs = await all<{ endpoint: string }>(env.DB, 'SELECT endpoint FROM push_subscriptions');
  const keys = { publicKey, privateKey };

  await Promise.all(
    subs.map(async ({ endpoint }) => {
      try {
        const jwt = await createVapidJwt(endpoint, subject, keys, now);
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            TTL: String(TTL_SECONDS),
            Urgency: 'normal',
            Authorization: `vapid t=${jwt}, k=${publicKey}`,
          },
        });
        if (res.status === 404 || res.status === 410) {
          await run(env.DB, 'DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
          result.removed++;
        } else if (res.ok) {
          result.sent++;
        } else {
          result.failed++;
        }
      } catch {
        result.failed++;
      }
    }),
  );
  return result;
}

async function publicKey(env: Env): Promise<Response> {
  if (!env.VAPID_PUBLIC_KEY) return json({ error: 'Push is not configured' }, 503);
  return json({ publicKey: env.VAPID_PUBLIC_KEY });
}

async function subscribe(request: Request, env: Env, now: Date): Promise<Response> {
  const body = await parseBody(request, subscribeBody);
  if (!body) return json({ error: 'Invalid subscription' }, 400);
  await run(
    env.DB,
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    body.endpoint,
    body.keys.p256dh,
    body.keys.auth,
    now.toISOString(),
  );
  return json({ ok: true }, 201);
}

async function unsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request, unsubscribeBody);
  if (!body) return json({ error: 'Invalid subscription' }, 400);
  await run(env.DB, 'DELETE FROM push_subscriptions WHERE endpoint = ?', body.endpoint);
  return json({ ok: true });
}

async function testPush(env: Env, now: Date): Promise<Response> {
  const result = await sendToAll(env, { kind: 'test', ...testMessage() }, { now });
  return json({ ok: true, ...result });
}

async function latest(env: Env): Promise<Response> {
  const { locale } = await readSettings(env.DB);
  const row = await first<NotificationRow>(env.DB, 'SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT 1');
  if (row) await run(env.DB, 'UPDATE notifications SET read = 1 WHERE id = ?', row.id);
  return json({ locale, notification: row ? toClient(row, locale) : null });
}

async function list(env: Env): Promise<Response> {
  const { locale } = await readSettings(env.DB);
  const rows = await all<NotificationRow>(env.DB, 'SELECT * FROM notifications ORDER BY id DESC LIMIT 30');
  return json({ locale, notifications: rows.map((r) => ({ ...toClient(r, locale), read: r.read === 1 })) });
}

/** Handles /api/push/* and /api/notifications*. Returns null for unmatched paths (the router then 404s). */
export async function handlePush(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const method = request.method.toUpperCase();
  const now = new Date();

  if (path === '/api/push/public-key' && method === 'GET') return publicKey(env);
  if (path === '/api/push/subscribe' && method === 'POST') return subscribe(request, env, now);
  if (path === '/api/push/unsubscribe' && method === 'POST') return unsubscribe(request, env);
  if (path === '/api/push/test' && method === 'POST') return testPush(env, now);
  if (path === '/api/notifications/latest' && method === 'GET') return latest(env);
  if (path === '/api/notifications' && method === 'GET') return list(env);
  return null;
}
