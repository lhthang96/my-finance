import { computeSummary } from '../shared/calc';
import { currentMonth } from '../shared/format';
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '../shared/types';
import type { AppState, Asset, Category, Settings, Snapshot, SpendingItem, Transaction } from '../shared/types';

/** Internal settings-table keys that are never returned to clients. */
export const INTERNAL_SETTING_KEYS = ['loginFailures'] as const;

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results;
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** Inserts a row from an object (keys = columns) and returns the new id. */
export async function insertRow(db: D1Database, table: string, data: Record<string, unknown>): Promise<number> {
  const cols = Object.keys(data);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const res = await run(db, sql, ...cols.map((c) => data[c]));
  return Number(res.meta.last_row_id ?? 0);
}

/** Updates the given columns of one row. Keys whose value is undefined are skipped. Returns the row. */
export async function updateRow(
  db: D1Database,
  table: string,
  id: number,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const cols = Object.keys(data).filter((c) => data[c] !== undefined);
  if (cols.length > 0) {
    const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    await run(db, sql, ...cols.map((c) => data[c]), id);
  }
  return first(db, `SELECT * FROM ${table} WHERE id = ?`, id);
}

export async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await run(
    db,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

/** Reads settings, falling back to defaults for missing keys. Internal keys are excluded. */
export async function readSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const out: Record<string, unknown> = { ...structuredClone(DEFAULT_SETTINGS) };
  for (const row of rows) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(row.key)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // keep default for a corrupt value
    }
  }
  return out as unknown as Settings;
}

/** Everything the app needs in one call (GET /api/state). */
export async function loadState(db: D1Database, now: Date): Promise<AppState> {
  const settings = await readSettings(db);
  const month = currentMonth(now, settings.timezone);
  const [spendingItems, assets, categories, snapshots, monthTransactions] = await Promise.all([
    all<SpendingItem>(db, 'SELECT * FROM spending_items ORDER BY sort, id'),
    all<Asset>(db, 'SELECT * FROM assets ORDER BY sort, id'),
    all<Category>(db, 'SELECT * FROM categories ORDER BY sort, id'),
    all<Snapshot>(db, 'SELECT * FROM snapshots ORDER BY month'),
    all<Transaction>(
      db,
      'SELECT * FROM transactions WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC',
      month,
    ),
  ]);
  return {
    settings,
    spendingItems,
    assets,
    categories,
    snapshots,
    monthTransactions,
    summary: computeSummary(settings, spendingItems, assets, now),
  };
}
