import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../src/worker/index';
import { createD1 } from '../../src/worker/d1-shim';
import { openDatabase } from '../../scripts/dev-server.mjs';

const BASE = 'http://localhost:8799';

function makeEnv() {
  const sqlite = openDatabase(':memory:', { seed: true });
  const env = {
    DB: createD1(sqlite),
    ASSETS: { fetch: async () => new Response('asset') },
    APP_PASSCODE: '1234',
    SESSION_SECRET: 'test-secret',
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
    VAPID_SUBJECT: 'mailto:test@localhost',
  };
  return { sqlite, env: env as unknown as Env };
}

type Call = { status: number; data: any; res: Response };

async function call(
  env: Env,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; url?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request((opts.url ?? BASE) + path, {
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
    // non-JSON body
  }
  return { status: res.status, data, res };
}

async function login(env: Env): Promise<string> {
  const r = await call(env, 'POST', '/api/auth/login', { body: { passcode: '1234' } });
  assert.equal(r.status, 200);
  const setCookie = r.res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

describe('auth', () => {
  it('unauthenticated /api/state is 401', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/api/state');
    assert.equal(r.status, 401);
  });

  it('wrong passcode is 401', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'POST', '/api/auth/login', { body: { passcode: '0000' } });
    assert.equal(r.status, 401);
    assert.equal(typeof r.data.error, 'string');
  });

  it('6 wrong attempts give 429, and the correct passcode is blocked while locked', async () => {
    const { env } = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await call(env, 'POST', '/api/auth/login', { body: { passcode: 'nope' } })).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    const ok = await call(env, 'POST', '/api/auth/login', { body: { passcode: '1234' } });
    assert.equal(ok.status, 429);
  });

  it('login sets a session cookie without Secure on localhost', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'POST', '/api/auth/login', { body: { passcode: '1234' } });
    assert.equal(r.status, 200);
    const setCookie = r.res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /^mf_session=[^;]+\.[^;]+;/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Max-Age=31536000/);
    assert.doesNotMatch(setCookie, /Secure/);
  });

  it('login cookie is Secure on a non-localhost https origin', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'POST', '/api/auth/login', {
      body: { passcode: '1234' },
      url: 'https://finance.example.com',
    });
    assert.match(r.res.headers.get('set-cookie') ?? '', /Secure/);
  });

  it('/api/auth/me reflects the session', async () => {
    const { env } = makeEnv();
    const before = await call(env, 'GET', '/api/auth/me');
    assert.deepEqual(before.data, { authenticated: false });
    const cookie = await login(env);
    const after = await call(env, 'GET', '/api/auth/me', { cookie });
    assert.deepEqual(after.data, { authenticated: true });
  });

  it('tampered cookie is rejected', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'B' : 'A');
    const r = await call(env, 'GET', '/api/state', { cookie: tampered });
    assert.equal(r.status, 401);
  });
});

describe('state and settings', () => {
  it('/api/state returns fiTarget 9060000000 and 10 seeded assets', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'GET', '/api/state', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.summary.fiTarget, 9060000000);
    assert.equal(r.data.assets.length, 10);
    assert.equal(r.data.spendingItems.length, 4);
    assert.equal(r.data.categories.length, 9);
    assert.equal(r.data.settings.loginFailures, undefined);
  });

  it('PUT /api/settings merges partially, including nested reminders', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'PUT', '/api/settings', {
      cookie,
      body: { salary: 60000000, reminders: { dailyLog: { hour: 22 } } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.salary, 60000000);
    assert.equal(r.data.targetMultiple, 30);
    assert.deepEqual(r.data.reminders.dailyLog, { enabled: true, hour: 22 });
    assert.deepEqual(r.data.reminders.monthEnd, { enabled: true, hour: 20 });
  });

  it('PUT /api/settings rejects invalid values with 400', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'PUT', '/api/settings', { cookie, body: { locale: 'fr' } });
    assert.equal(r.status, 400);
  });
});

describe('transactions', () => {
  it('create, update, list, delete', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const created = await call(env, 'POST', '/api/transactions', {
      cookie,
      body: { amount: 150000, category_id: 1, note: 'pho' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.kind, 'expense');
    assert.match(created.data.date, /^\d{4}-\d{2}-\d{2}$/);
    const id = created.data.id;

    const updated = await call(env, 'PUT', `/api/transactions/${id}`, { cookie, body: { amount: 170000 } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.amount, 170000);
    assert.equal(updated.data.note, 'pho');

    const month = created.data.date.slice(0, 7);
    const list = await call(env, 'GET', `/api/transactions?month=${month}`, { cookie });
    assert.ok(list.data.some((t: { id: number }) => t.id === id));

    const del = await call(env, 'DELETE', `/api/transactions/${id}`, { cookie });
    assert.equal(del.status, 200);
    const gone = await call(env, 'DELETE', `/api/transactions/${id}`, { cookie });
    assert.equal(gone.status, 404);
  });

  it('spending items: create, update, delete', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const created = await call(env, 'POST', '/api/spending-items', {
      cookie,
      body: { name: 'Gym', amount: 500000, period: 'month' },
    });
    assert.equal(created.status, 201);
    const upd = await call(env, 'PUT', `/api/spending-items/${created.data.id}`, {
      cookie,
      body: { amount: 600000 },
    });
    assert.equal(upd.data.amount, 600000);
    assert.equal((await call(env, 'DELETE', `/api/spending-items/${created.data.id}`, { cookie })).status, 200);
  });
});

describe('assets', () => {
  it('create, update, delete', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const created = await call(env, 'POST', '/api/assets', {
      cookie,
      body: { name: 'Gold', type: 'other', quantity: 2, amount: 80000000, counts_toward_fi: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.counts_toward_fi, 1);
    assert.ok(created.data.updated_at);

    const upd = await call(env, 'PUT', `/api/assets/${created.data.id}`, { cookie, body: { quantity: 3 } });
    assert.equal(upd.data.quantity, 3);
    assert.equal(upd.data.amount, 80000000);

    assert.equal((await call(env, 'DELETE', `/api/assets/${created.data.id}`, { cookie })).status, 200);
    const state = await call(env, 'GET', '/api/state', { cookie });
    assert.equal(state.data.assets.length, 10);
  });

  it('rejects an unknown asset type', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'POST', '/api/assets', {
      cookie,
      body: { name: 'X', type: 'crypto', amount: 1 },
    });
    assert.equal(r.status, 400);
  });
});

describe('snapshots', () => {
  it('POST upserts the current month', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'POST', '/api/snapshots', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.fi_assets, 378663900);
    const list = await call(env, 'GET', '/api/snapshots', { cookie });
    assert.ok(list.data.length >= 1);
  });
});

describe('export and import', () => {
  it('round trip keeps row counts', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    await call(env, 'POST', '/api/transactions', { cookie, body: { amount: 10000, category_id: 2 } });
    await call(env, 'POST', '/api/transactions', { cookie, body: { amount: 20000, kind: 'income' } });

    const exported = await call(env, 'GET', '/api/export', { cookie });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.transactions.length, 2);

    const imported = await call(env, 'POST', '/api/import', { cookie, body: exported.data });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.data.counts, {
      spending_items: 4,
      assets: 10,
      categories: 9,
      transactions: 2,
      snapshots: 1,
    });

    const again = await call(env, 'GET', '/api/export', { cookie });
    for (const table of ['spending_items', 'assets', 'categories', 'transactions', 'snapshots']) {
      assert.equal(again.data[table].length, exported.data[table].length, table);
    }
    assert.equal(again.data.settings.salary, exported.data.settings.salary);
  });

  it('import rejects a malformed body with 400', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const r = await call(env, 'POST', '/api/import', { cookie, body: { assets: 'nope' } });
    assert.equal(r.status, 400);
  });
});

describe('categories', () => {
  it('delete clears category_id on transactions', async () => {
    const { env } = makeEnv();
    const cookie = await login(env);
    const tx = await call(env, 'POST', '/api/transactions', { cookie, body: { amount: 5000, category_id: 1 } });
    const del = await call(env, 'DELETE', '/api/categories/1', { cookie });
    assert.equal(del.status, 200);
    const again = await call(env, 'GET', `/api/transactions?month=${tx.data.date.slice(0, 7)}`, { cookie });
    const row = again.data.find((t: { id: number }) => t.id === tx.data.id);
    assert.equal(row.category_id, null);
  });
});
