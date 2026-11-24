// Hourly job (wrangler.jsonc triggers.crons "0 * * * *"). `now` is the scheduled time.
// Each reminder is claimed once in reminder_log, so re-running in the same hour never duplicates it.
import { assetValue, computeSummary, monthSpendingActual } from '../shared/calc';
import type { Asset, Settings, SpendingItem, Transaction } from '../shared/types';
import { all, first, readSettings, run } from './db';
import { dailyLogMessage, maturityMessage, monthEndMessage } from './reminders-messages';
import { sendToAll } from './push';

export interface CronOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface Local {
  y: number;
  m: number;
  d: number;
  h: number;
  /** YYYY-MM-DD */
  ymd: string;
  /** YYYY-MM */
  ym: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock parts of `now` in the given IANA timezone. */
export function localParts(now: Date, tz: string): Local {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const h = get('hour');
  return { y, m, d, h, ymd: `${y}-${pad(m)}-${pad(d)}`, ym: `${y}-${pad(m)}` };
}

/** Days in the given month (m is 1-based). */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Adds months to a YYYY-MM-DD string, clamping the day to the target month's length (like EDATE). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(d, lastDayOfMonth(ty, tm));
  return `${ty}-${pad(tm)}-${pad(day)}`;
}

/** Claims a dedupe key. Returns false when it was already claimed. */
async function claim(env: Env, key: string, now: Date): Promise<boolean> {
  const res = await run(env.DB, 'INSERT OR IGNORE INTO reminder_log (key, sent_at) VALUES (?, ?)', key, now.toISOString());
  return (res.meta.changes ?? 0) > 0;
}

async function dailyLog(env: Env, s: Settings, p: Local, now: Date, opts: CronOptions): Promise<void> {
  const rule = s.reminders.dailyLog;
  if (!rule.enabled || p.h !== rule.hour) return;
  if (!(await claim(env, `daily:${p.ymd}`, now))) return;
  const row = await first<{ n: number; total: number }>(
    env.DB,
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE date = ? AND kind = 'expense'",
    p.ymd,
  );
  await sendToAll(env, { kind: 'dailyLog', ...dailyLogMessage(row?.n ?? 0, row?.total ?? 0) }, { now, fetchImpl: opts.fetchImpl });
}

async function monthEnd(env: Env, s: Settings, p: Local, now: Date, opts: CronOptions): Promise<void> {
  const rule = s.reminders.monthEnd;
  if (!rule.enabled || p.h !== rule.hour) return;
  if (p.d !== lastDayOfMonth(p.y, p.m)) return;
  if (!(await claim(env, `monthEnd:${p.ym}`, now))) return;
  await sendToAll(env, { kind: 'monthEnd', ...monthEndMessage() }, { now, fetchImpl: opts.fetchImpl });
}

async function maturity(env: Env, s: Settings, p: Local, now: Date, opts: CronOptions): Promise<void> {
  const rule = s.reminders.maturity;
  if (!rule.enabled || p.h !== rule.hour) return;
  const tomorrow = addDays(p.ymd, 1);
  const deposits = await all<Asset>(
    env.DB,
    "SELECT * FROM assets WHERE type = 'deposit' AND start_date IS NOT NULL AND term_months IS NOT NULL ORDER BY sort, id",
  );
  for (const a of deposits) {
    const matures = addMonths(a.start_date as string, a.term_months as number);
    if (matures !== tomorrow) continue;
    if (!(await claim(env, `maturity:${a.id}:${matures}`, now))) continue;
    await sendToAll(
      env,
      { kind: 'maturity', ...maturityMessage(a.name, assetValue(a)) },
      { now, fetchImpl: opts.fetchImpl },
    );
  }
}

/** On local day 1 at hour 0, upserts the previous month's snapshot (same shape as POST /api/snapshots). */
async function snapshot(env: Env, s: Settings, p: Local, now: Date): Promise<void> {
  if (p.d !== 1 || p.h !== 0) return;
  const prevY = p.m === 1 ? p.y - 1 : p.y;
  const prevM = p.m === 1 ? 12 : p.m - 1;
  const prev = `${prevY}-${pad(prevM)}`;
  if (!(await claim(env, `snapshot:${prev}`, now))) return;

  const [items, assets, tx] = await Promise.all([
    all<SpendingItem>(env.DB, 'SELECT * FROM spending_items'),
    all<Asset>(env.DB, 'SELECT * FROM assets'),
    all<Pick<Transaction, 'date' | 'amount' | 'kind'>>(
      env.DB,
      'SELECT date, amount, kind FROM transactions WHERE substr(date, 1, 7) = ?',
      prev,
    ),
  ]);
  const summary = computeSummary(s, items, assets, now);
  await run(
    env.DB,
    `INSERT INTO snapshots (month, net_worth, fi_assets, income, spending, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET net_worth = excluded.net_worth, fi_assets = excluded.fi_assets,
       income = excluded.income, spending = excluded.spending`,
    prev,
    Math.round(summary.netWorth),
    Math.round(summary.fiAssets),
    s.salary,
    monthSpendingActual(tx, prev),
    now.toISOString(),
  );
}

/** Runs every reminder that is due at `now`. Each step is isolated so one failure does not block the others. */
export async function runCron(env: Env, now: Date, opts: CronOptions = {}): Promise<void> {
  const settings = await readSettings(env.DB);
  const p = localParts(now, settings.timezone);
  const steps: [string, () => Promise<void>][] = [
    ['dailyLog', () => dailyLog(env, settings, p, now, opts)],
    ['monthEnd', () => monthEnd(env, settings, p, now, opts)],
    ['maturity', () => maturity(env, settings, p, now, opts)],
    ['snapshot', () => snapshot(env, settings, p, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      console.error(`cron step ${name} failed`, err);
    }
  }
}
