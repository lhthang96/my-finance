// B1 smoke tests: app shell, login, home dashboard, quick add, responsive layout, console hygiene.
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

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const problems: string[] = [];

/** Waits until visible text contains `needle` (ignores layout, works with count-up animations). */
async function waitForText(p: Page, needle: string, timeout = 8000): Promise<void> {
  await p.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout });
}

/** Waits until the element's own text contains `needle` (count-up values pass through intermediate numbers). */
async function waitForIn(p: Page, testId: string, needle: string, timeout = 8000): Promise<void> {
  await p.waitForFunction(
    ([id, n]) => (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').includes(n),
    [testId, needle] as const,
    { timeout },
  );
}

async function settle(p: Page, ms = 1500): Promise<void> {
  await p.waitForTimeout(ms);
}

async function login(p: Page): Promise<void> {
  await p.goto(server.url + '/');
  await p.getByTestId('passcode').waitFor();
  await p.screenshot({ path: path.join(SHOTS, 'b1-login.png') });
  await p.getByTestId('passcode').fill(PASSCODE);
  await p.keyboard.press('Enter');
  await p.getByTestId('fi-ring').waitFor({ timeout: 8000 });
}

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-b1-'));
  server = await startServer({ port: 0, dbPath: path.join(dir, 'test.sqlite'), fresh: true, passcode: PASSCODE });
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    const unauthorizedOk = res.status() === 401 && res.url().includes('/api/');
    if (res.status() >= 400 && !unauthorizedOk) problems.push(`HTTP ${res.status()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => problems.push(`failed: ${req.url()} ${req.failure()?.errorText ?? ''}`));
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('AC2 mobile home: ring 4,2%, target 9,06 tỷ, projection path', async () => {
  await login(page);
  await waitForIn(page, 'fi-ring', '4,2%');
  const text = await page.innerText('body');
  assert.ok(text.includes('9,06 tỷ'), 'FI target compact text 9,06 tỷ is shown');
  const ring = await page.getByTestId('fi-ring').innerText();
  assert.ok(ring.includes('4,2%'), `ring shows 4,2% (got "${ring}")`);
  assert.ok(text.includes('Còn thiếu 8,68 tỷ') || text.includes('8,68 tỷ'), 'remaining amount 8,68 tỷ shown');
  const paths = await page.locator('[data-testid=projection] svg path').count();
  assert.ok(paths >= 2, 'projection chart has SVG paths');
  await settle(page, 1200);
  await page.screenshot({ path: path.join(SHOTS, 'b1-home-mobile-top.png') });
  await page.getByTestId('projection').scrollIntoViewIfNeeded();
  await settle(page, 1400);
  await page.screenshot({ path: path.join(SHOTS, 'b1-home-mobile.png'), fullPage: false });
  assert.ok(await page.locator('.tabbar').isVisible(), 'tab bar visible on phone');
});

test('AC3 quick add: 150000 saved, toast, total shown, persisted after reload', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('quick-add-fab').click();
  await page.getByTestId('sheet').waitFor();
  // 150 + 000 on the numpad.
  await page.getByTestId('np-1').click();
  await page.getByTestId('np-5').click();
  await page.getByTestId('np-0').click();
  await page.getByTestId('np-000').click();
  await page.getByTestId('qa-amount').waitFor();
  assert.ok((await page.getByTestId('qa-amount').innerText()).includes('150.000'), 'numpad builds 150.000');
  await settle(page, 450);
  await page.screenshot({ path: path.join(SHOTS, 'b1-quickadd.png') });

  // Choose a category (the first chip is preselected; click "Ăn uống" explicitly).
  await page.locator('[data-testid=qa-categories] button', { hasText: 'Ăn uống' }).click();
  await page.getByTestId('qa-save').click();
  await page.getByTestId('toast').first().waitFor({ timeout: 4000 });
  await waitForText(page, 'Hôm nay: 150.000 ₫');
  assert.ok((await page.getByTestId('today-total').innerText()).includes('150.000 ₫'));

  // Wait for the outbox to drain, then reload: the value must come from the server.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mf-outbox-v1') ?? '[]').length === 0, undefined, {
    timeout: 8000,
  });
  await page.reload();
  await page.getByTestId('fi-ring').waitFor();
  await waitForText(page, 'Hôm nay: 150.000 ₫');
  assert.equal(await page.getByTestId('pending-badge').count(), 0, 'no pending badge after sync');
});

test('AC4 desktop 1280x800: sidebar visible, tab bar hidden, locale en shows 4.2% and 9.06B', async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(server.url + '/');
  await page.getByTestId('fi-ring').waitFor();
  await settle(page, 1500);
  assert.ok(await page.locator('.sidebar').isVisible(), 'sidebar visible on desktop');
  assert.equal(await page.locator('.tabbar').isVisible(), false, 'tab bar hidden on desktop');
  await page.screenshot({ path: path.join(SHOTS, 'b1-home-desktop.png') });

  const res = await page.request.put(server.url + '/api/settings', { data: { locale: 'en' } });
  assert.equal(res.status(), 200, 'locale switch accepted');
  await page.reload();
  await waitForIn(page, 'fi-ring', '4.2%');
  const text = await page.innerText('body');
  assert.ok(text.includes('9.06B'), 'compact target 9.06B in en');
  await page.request.put(server.url + '/api/settings', { data: { locale: 'vi' } });
});

test('AC5 no console errors or failed requests during the run', async () => {
  assert.deepEqual(problems, []);
});
