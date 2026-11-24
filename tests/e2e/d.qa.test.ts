// D QA: toast lifetime and placement, Plan layout, FAB clearance, and a full sanity flow on a fresh DB.
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
const pageErrors: string[] = [];

function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

const settle = (p: Page, ms = 600) => p.waitForTimeout(ms);

async function waitForIn(p: Page, testId: string, needle: string, timeout = 8000): Promise<void> {
  await p.waitForFunction(
    ([id, n]) => (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').includes(n),
    [testId, needle] as const,
    { timeout },
  );
}

/** Sends a rejected entry through the outbox (read at boot) and waits for its error toast. */
async function triggerRejectedToast(p: Page): Promise<void> {
  await p.evaluate(() => {
    localStorage.setItem(
      'mf-outbox-v1',
      JSON.stringify([
        {
          localId: `local-qa-${Date.now()}`,
          body: { date: '2026-11-24', amount: -5, kind: 'expense', category_id: null, note: '' },
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await p.reload();
  await p.getByTestId('toast').first().waitFor({ timeout: 8000 });
}

/** Navigates with the bottom tab bar (a hash change, as a user tap does). */
async function tapTab(p: Page, route: string): Promise<void> {
  await p.locator(`.tabbar [data-testid="nav-${route}"]`).click();
  await settle(p, 350);
}

async function assertNoToast(p: Page, context: string): Promise<void> {
  const count = await p.getByTestId('toast').count();
  assert.equal(count, 0, `no toast visible (${context})`);
}

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-d-qa-'));
  server = await startServer({ port: 0, dbPath: path.join(dir, 'qa.sqlite'), fresh: true, passcode: PASSCODE });
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(server.url + '/');
  await page.getByTestId('passcode').fill(PASSCODE);
  await page.keyboard.press('Enter');
  await page.getByTestId('fi-ring').waitFor({ timeout: 8000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('AC2 rejected outbox entry: localized friendly toast, gone within 7s', async () => {
  await triggerRejectedToast(page);
  const text = (await page.getByTestId('toast').first().innerText()).trim();
  assert.ok(text.includes('Không lưu được khoản chi: số tiền không hợp lệ'), `friendly text, got: ${text}`);
  assert.ok(!/Number must|amount:/i.test(text), 'no raw zod text');
  await page.getByTestId('toast').first().waitFor({ state: 'detached', timeout: 7000 });
});

test('AC2 navigating to another page clears a visible error toast', async () => {
  await triggerRejectedToast(page);
  await tapTab(page, 'spend');
  await assertNoToast(page, 'after navigating to Spend');
});

test('AC2 a success toast (Plan saved) disappears within 4s; tap also dismisses', async () => {
  await tapTab(page, 'plan');
  await page.getByTestId('plan-items').waitFor();
  const firstName = page.locator('[data-testid=item-name]').first();
  const original = await firstName.inputValue();
  await firstName.fill(`${original} x`);
  await page.getByTestId('plan-save').click();
  await page.getByTestId('toast').first().waitFor({ timeout: 4000 });
  await page.getByTestId('toast').first().waitFor({ state: 'detached', timeout: 4000 });
  // Restore the original name (second save), then check a tap dismisses the toast.
  await page.locator('[data-testid=item-name]').first().fill(original);
  await page.getByTestId('plan-save').click();
  await page.getByTestId('toast').first().waitFor({ timeout: 4000 });
  await page.getByTestId('toast').first().click();
  await assertNoToast(page, 'after tapping the toast');
});

test('AC3 Plan: item names fully visible, KPI grid has no orphan, last row clears the FAB', async () => {
  await tapTab(page, 'plan');
  await page.getByTestId('plan-items').waitFor();
  const layout = await page.evaluate(() => {
    const names = [...document.querySelectorAll<HTMLInputElement>('[data-testid=item-name]')];
    const fam = names.find((i) => i.value === 'Family spending');
    const cards = [...document.querySelectorAll<HTMLElement>('.out-grid > .out-card')];
    const last = cards[cards.length - 1];
    const lastW = last.getBoundingClientRect().width;
    const gridW = (last.parentElement as HTMLElement).getBoundingClientRect().width;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const addBtn = document.querySelector('[data-testid=plan-add-item]')!.getBoundingClientRect();
    const fab = document.querySelector('[data-testid=quick-add-fab]')!.getBoundingClientRect();
    return {
      famFound: !!fam,
      famFits: fam ? fam.scrollWidth <= fam.clientWidth + 1 && fam.clientWidth > 200 : false,
      cardCount: cards.length,
      lastSpansFull: lastW >= gridW - 2,
      addBottom: addBtn.bottom,
      fabTop: fab.top,
    };
  });
  assert.ok(layout.famFound, '"Family spending" item present');
  assert.ok(layout.famFits, 'Family spending name fits its input');
  if (layout.cardCount % 2 === 1) assert.ok(layout.lastSpansFull, 'odd last KPI card spans both columns');
  assert.ok(layout.addBottom <= layout.fabTop, `last row clears FAB (${layout.addBottom} <= ${layout.fabTop})`);
});

test('AC4 full flow: quick add, spend total, EN switch, home ring, settings logout', async () => {
  // Quick add 85k food.
  await page.getByTestId('quick-add-fab').click();
  await page.getByTestId('sheet').waitFor();
  await page.getByTestId('qa-typed').fill('85k');
  await page.locator('[data-testid=qa-categories] button', { hasText: 'Ăn uống' }).click();
  await page.getByTestId('qa-save').click();
  await page.getByTestId('toast').first().waitFor({ timeout: 4000 });

  // Spend shows 85.000 ₫ for today; the toast is cleared by the navigation.
  await tapTab(page, 'spend');
  await waitForIn(page, `day-${todayISO()}`, '85.000 ₫');
  await assertNoToast(page, 'Spend after quick add');
  await page.screenshot({ path: path.join(SHOTS, 'd-spend.png'), fullPage: true });

  // Home (VI) then screenshot.
  await tapTab(page, 'home');
  await page.getByTestId('fi-ring').waitFor();
  await settle(page, 1200);
  await assertNoToast(page, 'Home');
  await page.screenshot({ path: path.join(SHOTS, 'd-home.png'), fullPage: true });

  await tapTab(page, 'assets');
  await settle(page, 900);
  await assertNoToast(page, 'Assets');
  await page.screenshot({ path: path.join(SHOTS, 'd-assets.png'), fullPage: true });

  await tapTab(page, 'plan');
  await page.getByTestId('plan-items').waitFor();
  await settle(page, 900);
  await assertNoToast(page, 'Plan');
  await page.screenshot({ path: path.join(SHOTS, 'd-plan.png'), fullPage: true });

  // Switch to EN, Home ring shows 4.2%.
  await tapTab(page, 'settings');
  await page.getByTestId('lang-en').click();
  await settle(page, 400);
  await tapTab(page, 'home');
  await page.getByTestId('fi-ring').waitFor();
  await page.waitForFunction(() => (document.querySelector('.ring-pct')?.textContent ?? '').includes('4.2%'), undefined, {
    timeout: 8000,
  });

  // Settings -> logout -> login screen.
  await tapTab(page, 'settings');
  await page.getByTestId('logout').click();
  await page.getByTestId('passcode').waitFor({ timeout: 8000 });
  assert.equal(await page.getByTestId('passcode').isVisible(), true, 'back on the login screen');
});

test('no uncaught page errors during the run', () => {
  assert.deepEqual(pageErrors, []);
});
