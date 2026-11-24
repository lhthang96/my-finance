import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from '../../src/worker/d1-shim';
import { addDays, addMonths, localParts, runCron } from '../../src/worker/cron';
import { generateVapidKeys, type VapidKeys } from '../../src/worker/vapid';
import { openDatabase } from '../../scripts/dev-server.mjs';

/** Local wall-clock time in Asia/Ho_Chi_Minh (UTC+7) as the scheduled Date the cron receives. */
function local(y: number, m: number, d: number, h: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 7, 0, 0));
}

type Notif = { id: number; kind: string; title_en: string; body_en: string; title_vi: string; body_vi: string; url: string };

let keys: VapidKeys;
let sqlite: any;
let env: Env;
let pushCalls: number;
let fetchImpl: typeof fetch;

beforeEach(async () => {
  keys = await generateVapidKeys();
  sqlite = openDatabase(':memory:', { seed: true });
  env = {
    DB: createD1(sqlite),
    ASSETS: { fetch: async () => new Response('asset') },
    APP_PASSCODE: '1234',
    SESSION_SECRET: 'test-secret',
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.com',
  } as unknown as Env;
  // One subscription, and a mock push service that accepts everything.
  sqlite
    .prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)')
    .run('https://push.example.com/device', 'p', 'a', new Date().toISOString());
  pushCalls = 0;
  fetchImpl = (async () => {
    pushCalls++;
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
});

function notifications(kind?: string): Notif[] {
  const rows = kind
    ? sqlite.prepare('SELECT * FROM notifications WHERE kind = ? ORDER BY id').all(kind)
    : sqlite.prepare('SELECT * FROM notifications ORDER BY id').all();
  return rows as Notif[];
}

function setReminders(reminders: unknown) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'reminders'").run(JSON.stringify(reminders));
}

describe('date helpers', () => {
  it('localParts converts a UTC instant to Asia/Ho_Chi_Minh wall time', () => {
    const p = localParts(new Date('2026-11-24T14:00:00Z'), 'Asia/Ho_Chi_Minh');
    assert.equal(p.ymd, '2026-11-24');
    assert.equal(p.h, 21);
    assert.equal(localParts(new Date('2026-11-30T17:00:00Z'), 'Asia/Ho_Chi_Minh').ymd, '2026-12-01');
  });

  it('addDays and addMonths roll over years and clamp month ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addMonths('2026-11-14', 1), '2026-12-14');
    assert.equal(addMonths('2026-11-13', 6), '2027-05-13');
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  });
});

describe('daily log', () => {
  it('at 21:00 local with no transactions sends one dailyLog notification', async () => {
    await runCron(env, local(2026, 11, 24, 21), { fetchImpl });
    const rows = notifications('dailyLog');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title_en, "Log today's spending");
    assert.equal(rows[0].body_en, 'Nothing logged yet today.');
    assert.equal(pushCalls, 1);
  });

  it('running again in the same hour does not duplicate it', async () => {
    await runCron(env, local(2026, 11, 24, 21), { fetchImpl });
    await runCron(env, local(2026, 11, 24, 21), { fetchImpl });
    assert.equal(notifications('dailyLog').length, 1);
  });

  it('with dailyLog disabled nothing is sent', async () => {
    setReminders({
      dailyLog: { enabled: false, hour: 21 },
      monthEnd: { enabled: true, hour: 20 },
      maturity: { enabled: true, hour: 9 },
    });
    await runCron(env, local(2026, 11, 24, 21), { fetchImpl });
    assert.equal(notifications('dailyLog').length, 0);
    assert.equal(pushCalls, 0);
  });

  it('with today already logged it summarises entries and total in the locale', async () => {
    sqlite
      .prepare("INSERT INTO transactions (date, amount, kind, note, created_at) VALUES ('2026-11-24', 150000, 'expense', '', ?)")
      .run(new Date().toISOString());
    await runCron(env, local(2026, 11, 24, 21), { fetchImpl });
    const [row] = notifications('dailyLog');
    assert.equal(row.body_vi, 'Hôm nay: 1 khoản, 150.000 ₫');
    assert.equal(row.body_en, 'Today: 1 entries, 150,000 ₫');
  });

  it('does not fire at other hours', async () => {
    await runCron(env, local(2026, 11, 24, 20), { fetchImpl });
    assert.equal(notifications('dailyLog').length, 0);
  });
});

describe('deposit maturity', () => {
  it('at 09:00 local on 2026-12-13 announces deposits maturing on 2026-12-14, including Savings #2', async () => {
    await runCron(env, local(2026, 12, 13, 9), { fetchImpl });
    const rows = notifications('maturity');
    // Savings #2 to #6 all start 2026-11-14 with a 1-month term.
    assert.equal(rows.length, 5);
    const s2 = rows.find((r) => r.body_en.startsWith('Savings #2 '));
    assert.ok(s2, 'Savings #2 notification missing');
    assert.equal(s2.body_en, 'Savings #2 matures tomorrow (30,000,000 ₫)');
    assert.equal(s2.body_vi, 'Savings #2 đáo hạn ngày mai (30.000.000 ₫)');
    assert.equal(s2.title_en, 'Deposit matures tomorrow');
  });

  it('does not repeat the maturity notice on a second run', async () => {
    await runCron(env, local(2026, 12, 13, 9), { fetchImpl });
    await runCron(env, local(2026, 12, 13, 9), { fetchImpl });
    assert.equal(notifications('maturity').length, 5);
  });

  it('is silent on the day before the maturity window', async () => {
    await runCron(env, local(2026, 12, 12, 9), { fetchImpl });
    assert.equal(notifications('maturity').length, 0);
  });
});

describe('month end', () => {
  it('at 20:00 local on 2026-11-30 sends the month-end review', async () => {
    await runCron(env, local(2026, 11, 30, 20), { fetchImpl });
    const rows = notifications('monthEnd');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body_en, 'Update stock prices and balances.');
    assert.equal(rows[0].url, '/assets');
  });

  it('is not sent on other days', async () => {
    await runCron(env, local(2026, 11, 29, 20), { fetchImpl });
    assert.equal(notifications('monthEnd').length, 0);
  });
});

describe('monthly snapshot', () => {
  it('at 00:00 local on 2026-12-01 upserts the 2026-11 snapshot from live data', async () => {
    sqlite
      .prepare("INSERT INTO transactions (date, amount, kind, note, created_at) VALUES ('2026-11-10', 1000000, 'expense', '', ?)")
      .run(new Date().toISOString());
    await runCron(env, local(2026, 12, 1, 0), { fetchImpl });

    const snap = sqlite.prepare("SELECT * FROM snapshots WHERE month = '2026-11'").get() as Record<string, unknown>;
    assert.equal(snap.net_worth, 478663900);
    assert.equal(snap.fi_assets, 378663900);
    assert.equal(snap.income, 58000000);
    assert.equal(snap.spending, 1000000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 1);
  });

  it('is not repeated later the same day', async () => {
    await runCron(env, local(2026, 12, 1, 0), { fetchImpl });
    sqlite.prepare("UPDATE snapshots SET net_worth = 1 WHERE month = '2026-11'").run();
    await runCron(env, local(2026, 12, 1, 0), { fetchImpl });
    const snap = sqlite.prepare("SELECT net_worth FROM snapshots WHERE month = '2026-11'").get() as { net_worth: number };
    assert.equal(snap.net_worth, 1);
  });
});
