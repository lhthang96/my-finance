import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../src/worker/index';
import { createD1 } from '../../src/worker/d1-shim';
import { sendToAll } from '../../src/worker/push';
import { b64urlDecode, createVapidJwt, generateVapidKeys, type VapidKeys } from '../../src/worker/vapid';
import { openDatabase } from '../../scripts/dev-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://localhost:8799';
const enc = new TextEncoder();
const dec = new TextDecoder();

type FetchCall = { url: string; init: RequestInit };

/** Mock fetch that records calls and answers with the status for each endpoint (default 201). */
function mockFetch(statusFor: (url: string) => number = () => 201) {
  const calls: FetchCall[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: statusFor(String(url)) });
  };
  return { calls, fetchImpl: impl as unknown as typeof fetch };
}

async function verifyJwt(token: string, publicKey: string) {
  const [h, c, s] = token.split('.');
  const key = await crypto.subtle.importKey(
    'raw',
    b64urlDecode(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlDecode(s),
    enc.encode(`${h}.${c}`),
  );
  return {
    ok,
    sigBytes: b64urlDecode(s).length,
    header: JSON.parse(dec.decode(b64urlDecode(h))) as Record<string, unknown>,
    claims: JSON.parse(dec.decode(b64urlDecode(c))) as Record<string, unknown>,
  };
}

function makeEnv(keys: VapidKeys | null = null) {
  const sqlite = openDatabase(':memory:', { seed: true });
  const env = {
    DB: createD1(sqlite),
    ASSETS: { fetch: async () => new Response('asset') },
    APP_PASSCODE: '1234',
    SESSION_SECRET: 'test-secret',
    VAPID_PUBLIC_KEY: keys?.publicKey ?? '',
    VAPID_PRIVATE_KEY: keys?.privateKey ?? '',
    VAPID_SUBJECT: 'mailto:test@example.com',
  };
  return { sqlite, env: env as unknown as Env };
}

async function subscribe(env: Env, endpoint: string) {
  await env.DB.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)')
    .bind(endpoint, 'p256', 'auth', new Date().toISOString())
    .run();
}

async function countSubs(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
  return row?.n ?? 0;
}

type Reply = { status: number; data: any };

async function call(env: Env, method: string, path: string, opts: { body?: unknown; cookie?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await worker.fetch(req, env, {} as ExecutionContext);
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, data };
}

async function loginCookie(env: Env): Promise<string> {
  const req = new Request(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode: '1234' }),
  });
  const res = await worker.fetch(req, env, {} as ExecutionContext);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('VAPID keys', () => {
  it('scripts/gen-vapid.mjs prints a P-256 key pair in base64url', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-vapid.mjs')], { encoding: 'utf8' });
    const pub = /^VAPID_PUBLIC_KEY=(\S+)$/m.exec(out)?.[1] ?? '';
    const priv = /^VAPID_PRIVATE_KEY=(\S+)$/m.exec(out)?.[1] ?? '';
    assert.equal(b64urlDecode(pub).length, 65);
    assert.equal(b64urlDecode(pub)[0], 0x04);
    assert.equal(b64urlDecode(priv).length, 32);
    assert.match(out, /wrangler secret put VAPID_PUBLIC_KEY/);
    assert.match(out, /wrangler secret put VAPID_PRIVATE_KEY/);
  });

  it('generateVapidKeys yields the same encodings', async () => {
    const keys = await generateVapidKeys();
    assert.equal(b64urlDecode(keys.publicKey).length, 65);
    assert.equal(b64urlDecode(keys.privateKey).length, 32);
  });
});

describe('VAPID JWT', () => {
  it('is an ES256 JWT whose signature verifies with the public key and whose claims are correct', async () => {
    const keys = await generateVapidKeys();
    const now = new Date('2026-11-24T14:00:00Z');
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123?x=1';
    const jwt = await createVapidJwt(endpoint, 'mailto:test@example.com', keys, now);

    const v = await verifyJwt(jwt, keys.publicKey);
    assert.equal(v.ok, true);
    assert.equal(v.sigBytes, 64);
    assert.deepEqual(v.header, { typ: 'JWT', alg: 'ES256' });
    assert.equal(v.claims.aud, 'https://fcm.googleapis.com');
    assert.equal(v.claims.sub, 'mailto:test@example.com');
    assert.equal(v.claims.exp, Math.floor(now.getTime() / 1000) + 12 * 60 * 60);
  });

  it('a JWT does not verify with a different key', async () => {
    const keys = await generateVapidKeys();
    const other = await generateVapidKeys();
    const jwt = await createVapidJwt('https://push.example/x', 'mailto:a@b.c', keys, new Date());
    assert.equal((await verifyJwt(jwt, other.publicKey)).ok, false);
  });
});

describe('sendToAll', () => {
  it('sends a payload-less POST with TTL, Urgency and vapid Authorization to each subscription', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    await subscribe(env, 'https://push.example.com/one');
    await subscribe(env, 'https://push.example.com/two');
    const mock = mockFetch();

    const now = new Date('2026-11-24T14:00:00Z');
    const result = await sendToAll(env, { kind: 'test', title_en: 'T', body_en: 'B', title_vi: 'T', body_vi: 'B', url: '/' }, {
      fetchImpl: mock.fetchImpl,
      now,
    });

    assert.deepEqual({ sent: result.sent, removed: result.removed, failed: result.failed, skipped: result.skipped }, {
      sent: 2,
      removed: 0,
      failed: 0,
      skipped: false,
    });
    assert.equal(mock.calls.length, 2);
    for (const { url, init } of mock.calls) {
      assert.equal(init.method, 'POST');
      assert.equal(init.body, undefined);
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.TTL, '86400');
      assert.equal(headers.Urgency, 'normal');
      const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=(\S+)$/.exec(headers.Authorization);
      assert.ok(m, `unexpected Authorization: ${headers.Authorization}`);
      assert.equal(m[2], keys.publicKey);
      const v = await verifyJwt(m[1], keys.publicKey);
      assert.equal(v.ok, true);
      assert.equal(v.claims.aud, new URL(url).origin);
      assert.equal(v.claims.sub, 'mailto:test@example.com');
    }
  });

  it('deletes subscriptions that answer 410 or 404 and keeps the others', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    await subscribe(env, 'https://push.example.com/ok');
    await subscribe(env, 'https://push.example.com/gone');
    await subscribe(env, 'https://push.example.com/missing');
    const mock = mockFetch((url) => (url.endsWith('/gone') ? 410 : url.endsWith('/missing') ? 404 : 201));

    const result = await sendToAll(env, { kind: 'test', title_en: 'T', body_en: 'B', title_vi: 'T', body_vi: 'B', url: '/' }, {
      fetchImpl: mock.fetchImpl,
    });

    assert.equal(result.sent, 1);
    assert.equal(result.removed, 2);
    const rows = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all<{ endpoint: string }>();
    assert.deepEqual(rows.results.map((r) => r.endpoint), ['https://push.example.com/ok']);
  });

  it('without VAPID secrets it stores the notification, sends nothing and reports skipped', async () => {
    const { env, sqlite } = makeEnv(null);
    await subscribe(env, 'https://push.example.com/one');
    const mock = mockFetch();

    const result = await sendToAll(env, { kind: 'test', title_en: 'T', body_en: 'B', title_vi: 'T', body_vi: 'B', url: '/' }, {
      fetchImpl: mock.fetchImpl,
    });

    assert.equal(result.skipped, true);
    assert.equal(mock.calls.length, 0);
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM notifications WHERE kind = ?').get('test') as { n: number };
    assert.equal(row.n, 1);
  });
});

describe('push endpoints (through the router)', () => {
  it('require a session', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    assert.equal((await call(env, 'GET', '/api/push/public-key')).status, 401);
    assert.equal((await call(env, 'GET', '/api/notifications/latest')).status, 401);
  });

  it('public-key returns the configured key; 503 when unconfigured', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    const cookie = await loginCookie(env);
    const r = await call(env, 'GET', '/api/push/public-key', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.publicKey, keys.publicKey);

    const none = makeEnv(null);
    const cookie2 = await loginCookie(none.env);
    assert.equal((await call(none.env, 'GET', '/api/push/public-key', { cookie: cookie2 })).status, 503);
  });

  it('subscribe upserts by endpoint, unsubscribe removes it', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    const cookie = await loginCookie(env);
    const body = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'k1', auth: 'a1' } };

    assert.equal((await call(env, 'POST', '/api/push/subscribe', { cookie, body })).status, 201);
    assert.equal((await call(env, 'POST', '/api/push/subscribe', { cookie, body: { ...body, keys: { p256dh: 'k2', auth: 'a2' } } })).status, 201);
    assert.equal(await countSubs(env), 1);
    const row = await env.DB.prepare('SELECT p256dh FROM push_subscriptions').first<{ p256dh: string }>();
    assert.equal(row?.p256dh, 'k2');

    assert.equal((await call(env, 'POST', '/api/push/subscribe', { cookie, body: { endpoint: 'nope', keys: {} } })).status, 400);

    const un = await call(env, 'POST', '/api/push/unsubscribe', { cookie, body: { endpoint: body.endpoint } });
    assert.equal(un.status, 200);
    assert.equal(await countSubs(env), 0);
  });

  it('test push with no subscriptions stores a notification and sends nothing', async () => {
    const keys = await generateVapidKeys();
    const { env } = makeEnv(keys);
    const cookie = await loginCookie(env);
    const r = await call(env, 'POST', '/api/push/test', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.sent, 0);
    assert.equal(r.data.skipped, false);
    assert.equal(typeof r.data.id, 'number');
  });

  it('latest returns the unread notification in the user locale and marks it read; list returns recent ones', async () => {
    const { env } = makeEnv(null);
    const cookie = await loginCookie(env);
    await sendToAll(env, {
      kind: 'maturity',
      title_en: 'Deposit matures tomorrow',
      body_en: 'Savings #2 matures tomorrow (30,000,000 ₫)',
      title_vi: 'Tiền gửi đáo hạn ngày mai',
      body_vi: 'Savings #2 đáo hạn ngày mai (30.000.000 ₫)',
      url: '/assets',
    });

    // Seed locale is vi.
    const first = await call(env, 'GET', '/api/notifications/latest', { cookie });
    assert.equal(first.status, 200);
    assert.equal(first.data.locale, 'vi');
    assert.equal(first.data.notification.kind, 'maturity');
    assert.equal(first.data.notification.title, 'Tiền gửi đáo hạn ngày mai');
    assert.equal(first.data.notification.url, '/assets');

    const second = await call(env, 'GET', '/api/notifications/latest', { cookie });
    assert.equal(second.data.notification, null);

    const list = await call(env, 'GET', '/api/notifications', { cookie });
    assert.equal(list.status, 200);
    assert.equal(list.data.notifications.length, 1);
    assert.equal(list.data.notifications[0].read, true);
  });
});
