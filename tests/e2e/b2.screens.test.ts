// B2 screen tests: Spend, Plan, Assets, Settings, History, Home maturity grouping, screenshots and console hygiene.
// Run after `npm run build`: npm run test:e2e
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startServer } from '../../scripts/dev-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'test-results');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const PASSCODE = '1234';
const TZ = 'Asia/Ho_Chi_Minh';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const problems: string[] = [];
/** Set while a test deliberately makes the server refuse a request (the rejected outbox entry). */
let expectRejection = false;
/** Browser console lines that the deliberate rejection produces (one per expected 400). */
let allowedRejectionLogs = 0;

/** Today's date in the app's timezone as YYYY-MM-DD. */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

/** Waits until the element's own text contains `needle` (count-up values pass through intermediate numbers). */
async function waitForIn(p: Page, testId: string, needle: string, timeout = 8000): Promise<void> {
  await p.waitForFunction(
    ([id, n]) => (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').includes(n),
    [testId, needle] as const,
    { timeout },
  );
}

async function waitForText(p: Page, needle: string, timeout = 8000): Promise<void> {
  await p.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout });
}

async function settle(p: Page, ms = 1200): Promise<void> {
  await p.waitForTimeout(ms);
}

async function outboxEmpty(p: Page): Promise<void> {
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('mf-outbox-v1') ?? '[]').length === 0, undefined, {
    timeout: 8000,
  });
}

/** Opens a hash route in the running app (same document, no reload). */
async function go(p: Page, hash: string): Promise<void> {
  await p.goto(`${server.url}/#${hash}`);
  await settle(p, 350);
}

async function stateJson(p: Page): Promise<any> {
  const res = await p.request.get(`${server.url}/api/state`);
  assert.equal(res.status(), 200, 'GET /api/state');
  return res.json();
}

async function openQuickAdd(p: Page): Promise<void> {
  await p.getByTestId('quick-add-fab').click();
  await p.getByTestId('sheet').waitFor();
}

async function quickAdd(p: Page, amount: string, categoryName: string): Promise<void> {
  await openQuickAdd(p);
  await p.getByTestId('qa-typed').fill(amount);
  await p.locator('[data-testid=qa-categories] button', { hasText: categoryName }).click();
  await p.getByTestId('qa-save').click();
  await p.getByTestId('toast').first().waitFor({ timeout: 4000 });
  await settle(p, 500);
}

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-b2-'));
  server = await startServer({ port: 0, dbPath: path.join(dir, 'test.sqlite'), fresh: true, passcode: PASSCODE });
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (allowedRejectionLogs > 0 && msg.text().includes('status of 400')) {
      allowedRejectionLogs--;
      return;
    }
    problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    const unauthorizedOk = res.status() === 401 && res.url().includes('/api/');
    const expected = expectRejection && res.status() === 400 && res.url().endsWith('/api/transactions');
    if (expected) allowedRejectionLogs++;
    if (res.status() >= 400 && !unauthorizedOk && !expected) problems.push(`HTTP ${res.status()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => problems.push(`failed: ${req.url()} ${req.failure()?.errorText ?? ''}`));
  await page.goto(server.url + '/');
  await page.getByTestId('passcode').fill(PASSCODE);
  await page.keyboard.press('Enter');
  await page.getByTestId('fi-ring').waitFor({ timeout: 8000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('AC2 Spend: two quick-add expenses, edit one to 200k, delete one', async () => {
  await quickAdd(page, '45k', 'Ăn uống');
  await quickAdd(page, '120k', 'Đi lại');
  await outboxEmpty(page);

  await page.locator('.tabbar [data-testid="nav-spend"]').click();
  const today = todayISO();
  await page.getByTestId(`day-${today}`).waitFor();
  await waitForIn(page, `day-${today}`, '165.000 ₫');
  assert.equal(await page.locator('[data-testid^="tx-"]').count(), 2, 'both expenses listed');

  // Edit the 120k transport entry to 200k.
  await page.locator('[data-testid^="tx-"]', { hasText: 'Đi lại' }).click();
  await page.getByTestId('sheet').waitFor();
  await page.getByTestId('entry-amount').fill('200k');
  await page.getByTestId('entry-save').click();
  await waitForIn(page, `day-${today}`, '245.000 ₫');
  assert.ok((await page.getByTestId(`day-${today}`).innerText()).includes('245.000 ₫'), 'day total updated after edit');

  // Delete the food entry (confirm dialog accepted), then reload: only one row remains.
  await page.locator('[data-testid^="tx-"]', { hasText: 'Ăn uống' }).click();
  await page.getByTestId('sheet').waitFor();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('entry-delete').click();
  await page.reload();
  await page.getByTestId('spend-list').waitFor();
  await waitForIn(page, `day-${today}`, '200.000 ₫');
  assert.equal(await page.locator('[data-testid^="tx-"]').count(), 1, 'deleted entry is gone after reload');

  // Month switcher: next is disabled on the current month; the previous month is empty; back again.
  assert.equal(await page.getByTestId('month-next').isDisabled(), true, 'no future months');
  await page.getByTestId('month-prev').click();
  await page.getByTestId('spend-add-empty').waitFor();
  await page.getByTestId('month-next').click();
  await page.getByTestId(`day-${today}`).waitFor();
});

test('AC3 Plan: return 6,5% to 8% lowers years to goal, save feeds Home, Travel toggle is reset', async () => {
  await go(page, '/plan');
  await page.getByTestId('plan-years').waitFor();
  const yearsBefore = await page.getByTestId('plan-years').innerText();
  const parse = (s: string) => Number(s.match(/[\d,.]+/)?.[0].replace(',', '.') ?? NaN);
  const before = parse(yearsBefore);
  assert.ok(Number.isFinite(before), `years before is numeric (got "${yearsBefore}")`);
  assert.ok((await page.getByTestId('plan-return-input').inputValue()) === '6.5', 'starts at 6,5%');

  await page.getByTestId('plan-return-input').fill('8');
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-testid="plan-years"]');
      return !!el && el.textContent !== prev;
    },
    yearsBefore,
  );
  const after = parse(await page.getByTestId('plan-years').innerText());
  assert.ok(after < before, `years to goal decreases (${before} -> ${after})`);
  const delta = await page.getByTestId('plan-years-delta').innerText();
  assert.ok(delta.includes('−') && delta.includes('năm'), `delta shown (got "${delta}")`);

  await page.getByTestId('plan-save').click();
  await waitForText(page, 'Đã lưu kế hoạch');
  const saved = await stateJson(page);
  assert.ok(Math.abs(saved.settings.expectedReturn - 0.08) < 1e-9, 'expectedReturn saved as 0.08');

  // Home reflects the saved years (same formatting as the app).
  await page.goto(`${server.url}/#/`);
  await page.getByTestId('fi-ring').waitFor();
  const expectedYears = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(saved.summary.yearsToGoal);
  await waitForText(page, `Còn ${expectedYears} năm`);

  // Travel (4th item): Year -> Month, then Reset restores the saved draft.
  await go(page, '/plan');
  const travel = page.getByTestId('plan-item').nth(3);
  assert.equal(await travel.getByTestId('item-name').inputValue(), 'Travel');
  const yearBtn = travel.getByRole('button', { name: 'Năm', exact: true });
  assert.equal(await yearBtn.getAttribute('aria-pressed'), 'true', 'Travel starts as Year');
  await travel.getByRole('button', { name: 'Tháng', exact: true }).click();
  assert.equal(await travel.getByRole('button', { name: 'Tháng', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByTestId('plan-bar').waitFor();
  await page.getByTestId('plan-reset').click();
  await page.getByTestId('plan-bar').waitFor({ state: 'detached' });
  assert.equal(
    await page.getByTestId('plan-item').nth(3).getByRole('button', { name: 'Năm', exact: true }).getAttribute('aria-pressed'),
    'true',
    'Reset restores Year',
  );
  await settle(page, 300);
});

test('AC4 Assets: update BID price to 35000, then toggle Loan to friend into FI assets', async () => {
  const before = await stateJson(page);
  const bid = before.assets.find((a: any) => a.name === 'BID');
  const loan = before.assets.find((a: any) => a.name === 'Loan to friend');
  assert.ok(bid && loan, 'seeded assets exist');
  assert.equal(before.summary.netWorth, 478663900, 'seed net worth');
  await go(page, '/assets');

  await page.getByTestId('update-prices').click();
  await page.getByTestId(`price-${bid.id}`).fill('35000');
  await page.getByTestId('prices-save').click();
  await waitForText(page, 'Đã cập nhật giá');
  const afterPrices = await stateJson(page);
  assert.equal(afterPrices.summary.netWorth, 483550000, 'net worth rises by 1602 x 3050 = 4.886.100');

  // Loan to friend: counts toward FI.
  await page.getByTestId(`asset-${loan.id}`).click();
  await page.getByTestId('sheet').waitFor();
  assert.equal(await page.getByTestId('fi-toggle').getAttribute('aria-checked'), 'false');
  await page.getByTestId('fi-toggle').click();
  await page.getByTestId('asset-save').click();
  let fiAfter = 0;
  for (let i = 0; i < 40; i++) {
    fiAfter = (await stateJson(page)).summary.fiAssets;
    if (fiAfter === afterPrices.summary.fiAssets + 100000000) break;
    await settle(page, 150);
  }
  assert.equal(fiAfter, afterPrices.summary.fiAssets + 100000000, 'fiAssets increases by 100.000.000');

  // Add asset: type picker first, then the cash form.
  await page.getByTestId('add-asset').click();
  await page.getByTestId('pick-cash').click();
  await page.getByTestId('asset-name').fill('Wallet');
  await page.getByTestId('asset-amount').fill('500k');
  await page.getByTestId('asset-save').click();
  let wallet: any;
  for (let i = 0; i < 40 && !wallet; i++) {
    wallet = (await stateJson(page)).assets.find((a: any) => a.name === 'Wallet');
    if (!wallet) await settle(page, 150);
  }
  assert.ok(wallet && wallet.amount === 500000 && wallet.type === 'cash', 'new cash asset saved');
});

test('AC5 Settings: English labels, reminder toggle, exports, categories feed Quick add', async () => {
  await go(page, '/settings');
  await page.getByTestId('lang-en').click();
  await page.waitForFunction(() =>
    (document.querySelector('.tabbar [data-testid="nav-spend"]')?.textContent ?? '').includes('Spend'),
  );

  await page.getByTestId('reminder-dailyLog-switch').click();
  let enabled: boolean | undefined = true;
  for (let i = 0; i < 40 && enabled !== false; i++) {
    enabled = (await stateJson(page)).settings.reminders.dailyLog.enabled;
    if (enabled !== false) await settle(page, 150);
  }
  assert.equal(enabled, false, 'daily reminder disabled on the server');

  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  assert.ok(jsonDownload.suggestedFilename().endsWith('.json'), 'JSON export downloads');
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  assert.ok(csvDownload.suggestedFilename().endsWith('.csv'), 'CSV export downloads');

  await page.getByTestId('cat-icon').fill('☕');
  await page.getByTestId('cat-name-en').fill('Coffee');
  await page.getByTestId('cat-name-vi').fill('Cà phê');
  await page.getByTestId('cat-submit').click();
  await page.waitForFunction(() => document.body.innerText.includes('Coffee'));

  await openQuickAdd(page);
  const chip = page.locator('[data-testid=qa-categories] button', { hasText: 'Coffee' });
  await chip.waitFor();
  assert.ok((await chip.innerText()).includes('☕'), 'Coffee chip carries the emoji');
  await page.keyboard.press('Escape');
  await settle(page, 400);

  await go(page, '/settings');
  await page.getByTestId('lang-vi').click();
  await waitForText(page, 'Cài đặt');
});

test('AC6 History: Save snapshot now writes a row for the current month', async () => {
  await go(page, '/history');
  await page.getByTestId('snapshot-save').click();
  await waitForText(page, 'Đã lưu ảnh chụp');
  const month = todayISO().slice(0, 7);
  await page.getByTestId(`snap-row-${month}`).waitFor();
});

test('AC7 Home: deposits maturing on 14/12/2026 are one grouped row with five deposits', async () => {
  await page.goto(`${server.url}/#/`);
  await page.getByTestId('fi-ring').waitFor();
  const grouped = page.getByTestId('upcoming-2026-12-14');
  await grouped.waitFor();
  assert.equal(await grouped.count(), 1, 'one row for the 14/12/2026 maturity date');
  const text = await grouped.innerText();
  assert.ok(text.includes('5 khoản'), `row names five deposits (got "${text}")`);
  assert.ok(text.includes('150.000.000 ₫'), 'row shows the total 150.000.000 ₫');
  assert.equal(await page.locator('[data-testid^="upcoming-"]').count(), 1, 'no separate rows for each deposit');
});

test('Outbox: a queued entry the server refuses is dropped with a toast', async () => {
  expectRejection = true;
  await page.evaluate(() => {
    localStorage.setItem(
      'mf-outbox-v1',
      JSON.stringify([
        {
          localId: 'local-rejected-1',
          body: { date: '2026-11-24', amount: -5, kind: 'expense', category_id: null, note: '' },
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.reload(); // the outbox is read at boot
  await page.getByTestId('fi-ring').waitFor();
  await waitForText(page, 'Không lưu được khoản chi');
  await outboxEmpty(page);
  expectRejection = false;
});

test('AC8 screens at 390x844, desktop plan at 1280x800, no console errors', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, '/spend');
  await settle(page, 900);
  await page.screenshot({ path: path.join(SHOTS, 'b2-spend.png'), fullPage: true });
  await go(page, '/plan');
  await settle(page, 900);
  await page.screenshot({ path: path.join(SHOTS, 'b2-plan.png'), fullPage: true });
  await go(page, '/assets');
  await settle(page, 900);
  await page.screenshot({ path: path.join(SHOTS, 'b2-assets.png'), fullPage: true });
  await go(page, '/settings');
  await settle(page, 900);
  await page.screenshot({ path: path.join(SHOTS, 'b2-settings.png'), fullPage: true });
  await go(page, '/history');
  await settle(page, 900);
  await page.screenshot({ path: path.join(SHOTS, 'b2-history.png'), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  await go(page, '/plan');
  await settle(page, 1000);
  await page.screenshot({ path: path.join(SHOTS, 'b2-plan-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  for (const file of ['b2-spend.png', 'b2-plan.png', 'b2-assets.png', 'b2-settings.png', 'b2-history.png', 'b2-plan-desktop.png']) {
    assert.ok(fs.statSync(path.join(SHOTS, file)).size > 5000, `${file} written`);
  }
  assert.deepEqual(problems, [], 'no console errors, page errors or failed requests');
});
