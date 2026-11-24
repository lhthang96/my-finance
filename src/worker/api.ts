import { z } from 'zod';
import { monthSpendingActual } from '../shared/calc';
import { currentMonth, todayISO } from '../shared/format';
import type { Settings } from '../shared/types';
import { handlePush } from './push';
import {
  INTERNAL_SETTING_KEYS,
  all,
  first,
  getSetting,
  insertRow,
  loadState,
  readSettings,
  run,
  setSetting,
  updateRow,
} from './db';
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  cookieAttributes,
  isAuthenticated,
  makeSessionToken,
  timingSafeEqual,
} from './auth';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extraHeaders: [string, string][] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const [k, v] of extraHeaders) headers.append(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg);
  }
  return parsed.data;
}

// ---------- schemas ----------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM');
const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v === true || v === 1 ? 1 : 0));
const intId = (raw: string): number => Number(raw);

const reminderPatch = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

const settingsPatch = z.object({
  salary: z.number().int().min(0).optional(),
  targetMultiple: z.number().min(1).max(100).optional(),
  expectedReturn: z.number().min(0).max(1).optional(),
  horizons: z.array(z.number().int().min(1).max(60)).min(1).max(5).optional(),
  locale: z.enum(['en', 'vi']).optional(),
  reminders: z
    .object({
      dailyLog: reminderPatch.optional(),
      monthEnd: reminderPatch.optional(),
      maturity: reminderPatch.optional(),
    })
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
});

const itemBody = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.number().int().min(0),
  period: z.enum(['month', 'year']),
  sort: z.number().int().min(0).optional(),
});

const assetBody = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['deposit', 'cash', 'stock', 'receivable', 'other']),
  quantity: z.number().min(0).nullable().optional(),
  amount: z.number().int().min(0),
  counts_toward_fi: flag.optional(),
  interest_rate: z.number().min(0).max(1).nullable().optional(),
  start_date: dateStr.nullable().optional(),
  term_months: z.number().int().min(0).nullable().optional(),
  note: z.string().max(500).optional(),
  sort: z.number().int().min(0).optional(),
});

const txBody = z.object({
  date: dateStr.optional(),
  amount: z.number().int().min(0),
  kind: z.enum(['expense', 'income']).optional(),
  category_id: z.number().int().nullable().optional(),
  note: z.string().max(500).optional(),
});

const categoryBody = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'lowercase letters, digits, - or _'),
  name_en: z.string().trim().min(1).max(60),
  name_vi: z.string().trim().min(1).max(60),
  icon: z.string().min(1).max(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB'),
  sort: z.number().int().min(0).optional(),
  archived: flag.optional(),
});

const loginBody = z.object({ passcode: z.string().min(1).max(200) });

const importBody = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
  spending_items: z.array(z.record(z.string(), z.unknown())),
  assets: z.array(z.record(z.string(), z.unknown())),
  categories: z.array(z.record(z.string(), z.unknown())),
  transactions: z.array(z.record(z.string(), z.unknown())),
  snapshots: z.array(z.record(z.string(), z.unknown())),
});

// ---------- helpers ----------

async function getRow(db: D1Database, table: string, id: number): Promise<Record<string, unknown>> {
  const row = await first(db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

async function updateOrThrow(
  db: D1Database,
  table: string,
  id: number,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await updateRow(db, table, id, data);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

async function deleteRow(db: D1Database, table: string, id: number): Promise<Response> {
  const res = await run(db, `DELETE FROM ${table} WHERE id = ?`, id);
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return json({ ok: true });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE/i.test(err.message);
}

// ---------- handlers ----------

type Ctx = { request: Request; env: Env; url: URL; db: D1Database; now: Date; id: number };
type Handler = (c: Ctx) => Promise<Response>;

async function updateSettings(c: Ctx): Promise<Response> {
  const patch = await readBody(c.request, settingsPatch);
  const current = await readSettings(c.env.DB);
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    if (key === 'reminders' && patch.reminders) {
      const merged = {
        dailyLog: { ...current.reminders.dailyLog, ...patch.reminders.dailyLog },
        monthEnd: { ...current.reminders.monthEnd, ...patch.reminders.monthEnd },
        maturity: { ...current.reminders.maturity, ...patch.reminders.maturity },
      };
      await setSetting(c.env.DB, 'reminders', merged);
    } else if (patch[key] !== undefined) {
      await setSetting(c.env.DB, key, patch[key]);
    }
  }
  return json(await readSettings(c.env.DB));
}

async function createItem(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, itemBody);
  const id = await insertRow(c.db, 'spending_items', { ...b, sort: b.sort ?? 0 });
  return json(await getRow(c.db, 'spending_items', id), 201);
}

async function updateItem(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, itemBody.partial());
  return json(await updateOrThrow(c.db, 'spending_items', c.id, b));
}

async function createAsset(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, assetBody);
  const id = await insertRow(c.db, 'assets', {
    name: b.name,
    type: b.type,
    quantity: b.quantity ?? null,
    amount: b.amount,
    counts_toward_fi: b.counts_toward_fi ?? 1,
    interest_rate: b.interest_rate ?? null,
    start_date: b.start_date ?? null,
    term_months: b.term_months ?? null,
    note: b.note ?? '',
    sort: b.sort ?? 0,
    updated_at: c.now.toISOString(),
  });
  return json(await getRow(c.db, 'assets', id), 201);
}

async function updateAsset(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, assetBody.partial());
  return json(await updateOrThrow(c.db, 'assets', c.id, { ...b, updated_at: c.now.toISOString() }));
}

async function listTransactions(c: Ctx): Promise<Response> {
  const month = c.url.searchParams.get('month') ?? currentMonth(c.now);
  if (!monthStr.safeParse(month).success) throw new HttpError(400, 'month must be YYYY-MM');
  const rows = await all(
    c.db,
    'SELECT * FROM transactions WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC',
    month,
  );
  return json(rows);
}

async function createTransaction(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, txBody);
  const id = await insertRow(c.db, 'transactions', {
    date: b.date ?? todayISO(c.now),
    amount: b.amount,
    kind: b.kind ?? 'expense',
    category_id: b.category_id ?? null,
    note: b.note ?? '',
    created_at: c.now.toISOString(),
  });
  return json(await getRow(c.db, 'transactions', id), 201);
}

async function updateTransaction(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, txBody.partial());
  return json(await updateOrThrow(c.db, 'transactions', c.id, b));
}

async function createCategory(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, categoryBody);
  try {
    const id = await insertRow(c.db, 'categories', {
      key: b.key,
      name_en: b.name_en,
      name_vi: b.name_vi,
      icon: b.icon,
      color: b.color,
      sort: b.sort ?? 0,
      archived: b.archived ?? 0,
    });
    return json(await getRow(c.db, 'categories', id), 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'Category key already exists');
    throw err;
  }
}

async function updateCategory(c: Ctx): Promise<Response> {
  const b = await readBody(c.request, categoryBody.partial());
  try {
    return json(await updateOrThrow(c.db, 'categories', c.id, b));
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'Category key already exists');
    throw err;
  }
}

async function deleteCategory(c: Ctx): Promise<Response> {
  await getRow(c.db, 'categories', c.id);
  // Transactions keep their amount but lose the category reference.
  await c.db.batch([
    c.db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ?').bind(c.id),
    c.db.prepare('DELETE FROM categories WHERE id = ?').bind(c.id),
  ]);
  return json({ ok: true });
}

async function createOrUpdateSnapshot(c: Ctx): Promise<Response> {
  const state = await loadState(c.db, c.now);
  const month = currentMonth(c.now, state.settings.timezone);
  const row = {
    month,
    net_worth: Math.round(state.summary.netWorth),
    fi_assets: Math.round(state.summary.fiAssets),
    income: state.settings.salary,
    spending: monthSpendingActual(state.monthTransactions, month),
    created_at: c.now.toISOString(),
  };
  await run(
    c.db,
    `INSERT INTO snapshots (month, net_worth, fi_assets, income, spending, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET net_worth = excluded.net_worth, fi_assets = excluded.fi_assets,
       income = excluded.income, spending = excluded.spending`,
    row.month,
    row.net_worth,
    row.fi_assets,
    row.income,
    row.spending,
    row.created_at,
  );
  return json(await first(c.db, 'SELECT * FROM snapshots WHERE month = ?', month));
}

async function listSnapshots(c: Ctx): Promise<Response> {
  return json(await all(c.db, 'SELECT * FROM snapshots ORDER BY month'));
}

async function exportData(c: Ctx): Promise<Response> {
  const settingRows = await all<{ key: string; value: string }>(
    c.db,
    'SELECT key, value FROM settings WHERE key NOT IN (?)',
    INTERNAL_SETTING_KEYS[0],
  );
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  const [spending_items, assets, categories, transactions, snapshots] = await Promise.all([
    all(c.db, 'SELECT * FROM spending_items ORDER BY id'),
    all(c.db, 'SELECT * FROM assets ORDER BY id'),
    all(c.db, 'SELECT * FROM categories ORDER BY id'),
    all(c.db, 'SELECT * FROM transactions ORDER BY id'),
    all(c.db, 'SELECT * FROM snapshots ORDER BY month'),
  ]);
  const day = todayISO(c.now);
  return json(
    {
      format: 'my-finance',
      version: 1,
      exportedAt: c.now.toISOString(),
      settings,
      spending_items,
      assets,
      categories,
      transactions,
      snapshots,
    },
    200,
    [['content-disposition', `attachment; filename="my-finance-${day}.json"`]],
  );
}

const IMPORT_COLUMNS: Record<string, string[]> = {
  spending_items: ['id', 'name', 'amount', 'period', 'sort'],
  assets: [
    'id', 'name', 'type', 'quantity', 'amount', 'counts_toward_fi', 'interest_rate',
    'start_date', 'term_months', 'note', 'sort', 'updated_at',
  ],
  categories: ['id', 'key', 'name_en', 'name_vi', 'icon', 'color', 'sort', 'archived'],
  transactions: ['id', 'date', 'amount', 'kind', 'category_id', 'note', 'created_at'],
  snapshots: ['month', 'net_worth', 'fi_assets', 'income', 'spending', 'created_at'],
};

async function importData(c: Ctx): Promise<Response> {
  const data = await readBody(c.request, importBody);
  const stmts: D1PreparedStatement[] = [];
  for (const table of ['transactions', 'assets', 'spending_items', 'categories', 'snapshots']) {
    stmts.push(c.db.prepare(`DELETE FROM ${table}`));
  }
  stmts.push(c.db.prepare('DELETE FROM settings WHERE key NOT IN (?)').bind(INTERNAL_SETTING_KEYS[0]));

  for (const [key, value] of Object.entries(data.settings ?? {})) {
    if ((INTERNAL_SETTING_KEYS as readonly string[]).includes(key)) continue;
    stmts.push(c.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)));
  }

  const counts: Record<string, number> = {};
  for (const [table, cols] of Object.entries(IMPORT_COLUMNS)) {
    const rows = data[table as keyof typeof data] as Record<string, unknown>[];
    counts[table] = rows.length;
    for (const row of rows) {
      const values = cols.map((col) => (row[col] === undefined ? null : row[col]));
      stmts.push(
        c.db
          .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .bind(...values),
      );
    }
  }

  try {
    await c.db.batch(stmts);
  } catch (err) {
    throw new HttpError(400, `Import failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  return json({ ok: true, counts });
}

const ROUTES: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/state$/, async (c) => json(await loadState(c.db, c.now))],
  ['PUT', /^\/api\/settings$/, updateSettings],

  ['POST', /^\/api\/spending-items$/, createItem],
  ['PUT', /^\/api\/spending-items\/(\d+)$/, updateItem],
  ['DELETE', /^\/api\/spending-items\/(\d+)$/, (c) => deleteRow(c.db, 'spending_items', c.id)],

  ['POST', /^\/api\/assets$/, createAsset],
  ['PUT', /^\/api\/assets\/(\d+)$/, updateAsset],
  ['DELETE', /^\/api\/assets\/(\d+)$/, (c) => deleteRow(c.db, 'assets', c.id)],

  ['GET', /^\/api\/transactions$/, listTransactions],
  ['POST', /^\/api\/transactions$/, createTransaction],
  ['PUT', /^\/api\/transactions\/(\d+)$/, updateTransaction],
  ['DELETE', /^\/api\/transactions\/(\d+)$/, (c) => deleteRow(c.db, 'transactions', c.id)],

  ['POST', /^\/api\/categories$/, createCategory],
  ['PUT', /^\/api\/categories\/(\d+)$/, updateCategory],
  ['DELETE', /^\/api\/categories\/(\d+)$/, deleteCategory],

  ['POST', /^\/api\/snapshots$/, createOrUpdateSnapshot],
  ['GET', /^\/api\/snapshots$/, listSnapshots],

  ['GET', /^\/api\/export$/, exportData],
  ['POST', /^\/api\/import$/, importData],
];

// ---------- auth endpoints ----------

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readBody(request, loginBody);
  if (!env.APP_PASSCODE) throw new HttpError(500, 'APP_PASSCODE is not configured');
  const db = env.DB;
  const nowMs = Date.now();

  let failures = await getSetting(db, 'loginFailures', { count: 0, since: 0 });
  const windowActive = nowMs - failures.since < LOGIN_WINDOW_MS;
  if (!windowActive) failures = { count: 0, since: nowMs };
  if (windowActive && failures.count >= LOGIN_MAX_FAILURES) {
    return json({ error: 'Too many failed attempts. Try again later.' }, 429);
  }

  if (!timingSafeEqual(body.passcode, env.APP_PASSCODE)) {
    await setSetting(db, 'loginFailures', { count: failures.count + 1, since: failures.since });
    return json({ error: 'Wrong passcode' }, 401);
  }

  await setSetting(db, 'loginFailures', { count: 0, since: 0 });
  const token = await makeSessionToken(env.SESSION_SECRET, nowMs + SESSION_MAX_AGE_S * 1000);
  const cookie = `${SESSION_COOKIE}=${token}; ${cookieAttributes(url, SESSION_MAX_AGE_S)}`;
  return json({ ok: true }, 200, [['set-cookie', cookie]]);
}

function logout(url: URL): Response {
  const cookie = `${SESSION_COOKIE}=; ${cookieAttributes(url, 0)}`;
  return json({ ok: true }, 200, [['set-cookie', cookie]]);
}

// ---------- entry ----------

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const method = request.method.toUpperCase();
  const now = new Date();
  try {
    if (path === '/api/auth/login' && method === 'POST') return await login(request, env, url);
    if (path === '/api/auth/logout' && method === 'POST') return logout(url);
    if (path === '/api/auth/me' && method === 'GET') {
      return json({ authenticated: await isAuthenticated(request, env) });
    }

    if (!(await isAuthenticated(request, env))) return json({ error: 'Unauthorized' }, 401);

    if (path.startsWith('/api/push/') || path.startsWith('/api/notifications')) {
      const pushRes = await handlePush(request, env, url);
      if (pushRes) return pushRes;
    }

    for (const [m, re, handler] of ROUTES) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (!match) continue;
      return await handler({ request, env, url, db: env.DB, now, id: intId(match[1] ?? '0') });
    }
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
}
