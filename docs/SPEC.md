# My Finance — PWA spec

Personal financial-independence (FI) tracker for one user (Thang). Dark theme, English + Vietnamese, works on laptop and phone, installable PWA, reminder notifications. Everything in VND.

## Hard constraints (build environment)

- **No package installs.** `node_modules` is a symlink to a pre-installed set. Only these runtime/dev packages exist: `react@19.2.8`, `react-dom@19.2.8`, `d3@7.9.0` (and `d3-*`), `clsx`, `zod@3.25.76`, `esbuild@0.28.2`, `typescript@6.0.3`, `tsx@4.23.12`, `playwright@1.63.0`. There is **no** `@types/react`, Vite, Tailwind CLI, framer-motion, wrangler or test framework.
- List the packages above in `package.json` `dependencies`/`devDependencies` with those exact versions, plus `wrangler` (`^4`) as a devDependency for deploying from the user's machine. Do not import wrangler anywhere.
- Tests use Node's built-in `node:test` + `node:assert`, run with `tsx` (`node --import tsx --test`). SQLite for local/test uses Node's built-in `node:sqlite` (`DatabaseSync`).
- Chromium for e2e: `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (use `PLAYWRIGHT_CHROMIUM_PATH` env, defaulting to that path).
- Styling: hand-written CSS with CSS variables (no Tailwind). Animations: CSS transitions/keyframes + `d3-transition`/`requestAnimationFrame`.
- Type-checking: `tsc --noEmit -p tsconfig.json` covers `src/shared` and `src/worker` only (React has no types here). Web code is TSX compiled by esbuild without type-checking.

## Architecture

One **Cloudflare Worker** with static assets:

- `dist/public/` → static assets (app shell, SW, manifest, icons), served by Workers Static Assets with SPA fallback (`not_found_handling: "single-page-application"`).
- `dist/worker.js` → Worker entry: `fetch` handles `/api/*`; `scheduled` runs the hourly cron.
- **D1** database binding `DB`. Secrets: `APP_PASSCODE`, `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (base64url raw keys), var `VAPID_SUBJECT` (mailto:).
- `wrangler.jsonc`: `main: "dist/worker.js"`, `assets: { directory: "dist/public", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`, `d1_databases` (`binding: DB`, `database_name: my-finance`, `migrations_dir: db/migrations`), `triggers.crons: ["0 * * * *"]`, `compatibility_date: "2026-11-01"`.

Local dev/test (no wrangler): `scripts/dev-server.mjs` (run via tsx) serves `dist/public` and forwards `/api/*` to the Worker's `fetch` handler, with `env.DB` = a **D1 shim** over `node:sqlite` (`src/worker/d1-shim.ts`, implements `prepare().bind().first()/all()/run()` and `batch()`; `all()` returns `{ results }`, `run()` returns `{ meta: { changes, last_row_id } }`). DB file `.local-db/dev.sqlite`; the dev server applies `db/migrations/*.sql` and, if the DB is new, `db/seed.sql`. Env: `APP_PASSCODE=1234`, `SESSION_SECRET=dev-secret` unless set.

## File layout & ownership

```
package.json, tsconfig.json, wrangler.jsonc, README.md      (A)
scripts/build.mjs        esbuild: web → dist/public/app.js (+ app.css copy), sw → dist/public/sw.js, worker → dist/worker.js; copies src/web/public/* to dist/public  (A)
scripts/dev-server.mjs   (A)
scripts/gen-vapid.mjs    prints VAPID key pair (node:crypto, P-256, base64url)  (C)
db/migrations/0001_init.sql, db/seed.sql   (A)
src/shared/types.ts, calc.ts, format.ts, i18n.ts   (A)
src/worker/index.ts, router + handlers, auth.ts, db.ts, d1-shim.ts   (A)
src/worker/push.ts, cron.ts   (C)  — index.ts calls `runCron(env, now)` from cron.ts in `scheduled`
src/web/sw.ts, src/web/lib/push-client.ts   (C)
src/web/** everything else (index.html, main.tsx, App, pages, components, styles.css, public/manifest + icons)   (B)
tests/unit/*.test.ts  (A, C add their own),  tests/e2e/*.test.ts  (D)
```

## Data model (D1 / SQLite)

```sql
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)            -- JSON values
spending_items(id INTEGER PK, name TEXT, amount INTEGER, period TEXT CHECK(period IN ('month','year')), sort INTEGER DEFAULT 0)
assets(id INTEGER PK, name TEXT, type TEXT CHECK(type IN ('deposit','cash','stock','receivable','other')),
       quantity REAL NULL, amount INTEGER,           -- amount = VND amount, or unit price when quantity is set
       counts_toward_fi INTEGER DEFAULT 1, interest_rate REAL NULL, start_date TEXT NULL, term_months INTEGER NULL,
       note TEXT DEFAULT '', sort INTEGER DEFAULT 0, updated_at TEXT)
categories(id INTEGER PK, key TEXT UNIQUE, name_en TEXT, name_vi TEXT, icon TEXT, color TEXT, sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0)
transactions(id INTEGER PK, date TEXT, amount INTEGER, kind TEXT CHECK(kind IN ('expense','income')) DEFAULT 'expense',
             category_id INTEGER NULL, note TEXT DEFAULT '', created_at TEXT)
snapshots(month TEXT PRIMARY KEY, net_worth INTEGER, fi_assets INTEGER, income INTEGER, spending INTEGER, created_at TEXT)  -- month 'YYYY-MM'
push_subscriptions(endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, created_at TEXT)
notifications(id INTEGER PK, kind TEXT, title_en TEXT, body_en TEXT, title_vi TEXT, body_vi TEXT, url TEXT, created_at TEXT, read INTEGER DEFAULT 0)
reminder_log(key TEXT PRIMARY KEY, sent_at TEXT)               -- dedupe, e.g. 'daily:2026-11-24'
```

Settings keys (with seed defaults): `salary`=58000000, `targetMultiple`=30, `expectedReturn`=0.065, `horizons`=[5,10], `locale`="vi", `reminders`={"dailyLog":{"enabled":true,"hour":21},"monthEnd":{"enabled":true,"hour":20},"maturity":{"enabled":true,"hour":9}}, `timezone`="Asia/Ho_Chi_Minh".

Seed (`db/seed.sql`) — the user's real status on 24/11/2026:
- spending_items: House rent 6,000,000/month; Family spending 13,500,000/month; Personal spending 4,000,000/month; Travel 20,000,000/year.
- assets: Savings #1 deposit 50,000,000, 6 months from 2026-11-13; Savings #2..#6 deposit 30,000,000 each, 1 month from 2026-11-14; Bank account cash 118,000,000 (note "Emergency fund and daily spending"); Loan to friend receivable 100,000,000, counts_toward_fi=0 (note "Expected back in 1–2 years"); BID stock quantity 1602 unit price 31,950; SSI stock quantity 480 unit price 19,750.
- categories (key, en, vi, icon emoji, color): food "Food & drinks"/"Ăn uống" 🍜 #F59E0B; transport "Transport"/"Đi lại" 🛵 #38BDF8; family "Family"/"Gia đình" 👨‍👩‍👧 #F472B6; housing "Housing & bills"/"Nhà & hoá đơn" 🏠 #A78BFA; shopping "Shopping"/"Mua sắm" 🛍️ #FB7185; health "Health"/"Sức khoẻ" 💊 #34D399; fun "Entertainment"/"Giải trí" 🎮 #F97316; travel "Travel"/"Du lịch" ✈️ #22D3EE; other "Other"/"Khác" ✨ #94A3B8.
- snapshots: '2026-11' net_worth 478,663,900, fi_assets 378,663,900, income 58,000,000, spending NULL.

## Shared calculations (`src/shared/calc.ts`, pure, no I/O)

Types in `src/shared/types.ts`: `Settings`, `SpendingItem`, `Asset`, `Category`, `Transaction`, `Snapshot`, `Summary`.

- `assetValue(a)` = quantity != null ? quantity × amount : amount.
- `monthlySpending(items)` = Σ (period==='year' ? amount/12 : amount). `annualSpending` = ×12.
- `fiTarget` = annualSpending × targetMultiple.
- `netWorth` = Σ assetValue; `fiAssets` = Σ assetValue where counts_toward_fi.
- `progress` = fiAssets / target (0 if target 0); `remaining` = max(0, target − fiAssets).
- `passiveMonthly` = fiAssets × expectedReturn / 12; `coverage` = passiveMonthly / monthlySpending.
- `monthlySaving` = salary − monthlySpending; `savingsRate` = monthlySaving / salary.
- `monthlyRate(r)` = (1+r)^(1/12) − 1.
- `requiredMonthly(years)` = max(0, −PMT(rm, years×12, −fiAssets, target)) — implement `pmt`, `fv`, `nper` like spreadsheet functions.
- `yearsToGoal` = 0 if fiAssets ≥ target; null if monthlySaving ≤ 0; else NPER(rm, −saving, −fiAssets, target)/12. `fiDate(now)` = now + ceil(years×12) months.
- `projection(years=20)` → [{year, value: FV(rm, year×12, −saving, −fiAssets)}].
- `computeSummary(settings, items, assets, now)` → all of the above plus `plans: [{years, requiredMonthly, extraNeeded}]` for each horizon.
- `monthSpendingActual(transactions, 'YYYY-MM')` and `byCategory(...)`.

**Golden values** (must match the Google Sheet; unit tests assert them, rounding to integer VND unless noted): monthlySpending 25,166,667 (25,166,666.67); annual 302,000,000; target 9,060,000,000; netWorth 478,663,900; fiAssets 378,663,900; progress 0.0418 (±0.0001); remaining 8,681,336,100; passiveMonthly 2,051,096; coverage 0.0815; monthlySaving 32,833,333; savingsRate 0.5661; requiredMonthly(5) 121,434,181; requiredMonthly(10) 50,084,414; yearsToGoal 13.31 (±0.01); projection year 1 ≈ 808,881,514.

## Formatting & i18n (`src/shared/format.ts`, `i18n.ts`)

- `formatVND(n, locale)`: vi → `1.234.567 ₫`, en → `1,234,567 ₫` (use `Intl.NumberFormat`, no decimals).
- `formatCompact(n, locale)`: vi → `9,06 tỷ`, `378,7 tr`, `500 N`; en → `9.06B`, `378.7M`, `500K`.
- `parseAmount(text)`: accepts `150k`, `1.5tr`, `1,5m`, `2tỷ`, `25.000`, `25000` → integer VND. (k=1e3, m/tr/triệu=1e6, b/tỷ=1e9; strip `.`/`,` thousand separators when no unit; treat `,` or `.` as decimal when a unit follows.)
- `i18n.ts`: `dict = { en: {...}, vi: {...} }` with identical keys, and `t(locale, key, vars?)` with `{name}` interpolation. Every UI string goes through `t`. Natural Vietnamese (e.g. "Tự do tài chính", "Tài sản sinh lời", "Thu nhập thụ động", "Còn thiếu", "Tiết kiệm mỗi tháng").

## API (JSON, all under `/api`, all except auth require the session cookie)

- `POST /api/auth/login {passcode}` → 200 + `Set-Cookie: mf_session=<payload>.<hmac>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000` (HMAC-SHA256 via WebCrypto with SESSION_SECRET; omit `Secure` when request is http://localhost). Wrong passcode → 401. Rate-limit: after 5 failures in 10 min → 429 (store in settings key `loginFailures`).
- `POST /api/auth/logout`; `GET /api/auth/me` → `{authenticated:boolean}` (no auth required).
- `GET /api/state` → `{settings, spendingItems, assets, categories, snapshots, monthTransactions (current month, Asia/Ho_Chi_Minh), summary}` — one call loads the whole app.
- `PUT /api/settings` (partial merge) → updated settings.
- `POST|PUT /api/spending-items[/:id]`, `DELETE /api/spending-items/:id`.
- `POST|PUT /api/assets[/:id]`, `DELETE /api/assets/:id` (set updated_at).
- `GET /api/transactions?month=YYYY-MM`, `POST /api/transactions {date?, amount, kind?, category_id?, note?}` (date defaults to today in Asia/Ho_Chi_Minh), `PUT /api/transactions/:id`, `DELETE /api/transactions/:id`.
- `POST|PUT|DELETE /api/categories[/:id]`.
- `POST /api/snapshots` (upsert current month from live summary + month transactions); `GET /api/snapshots`.
- `GET /api/export` → full JSON dump; `POST /api/import` → replace all tables from that JSON (validate with zod).
- Push (C): `GET /api/push/public-key`, `POST /api/push/subscribe {endpoint, keys:{p256dh,auth}}`, `POST /api/push/unsubscribe`, `POST /api/push/test`, `GET /api/notifications/latest` (latest unread, marks read), `GET /api/notifications`.
- Validate bodies with zod; errors → `{error: string}` with 400/401/404. Amounts are integers ≥ 0.

## Reminders & push (C)

- Cron hourly. Compute local time in Asia/Ho_Chi_Minh. Dedupe with `reminder_log`.
  - **dailyLog** at `reminders.dailyLog.hour`: if no transaction today → "Log today's spending" / "Ghi chi tiêu hôm nay"; if there are some → "Today: {n} entries, {total}".
  - **monthEnd** on the last day of the month at its hour: "Month-end review — update stock prices and balances" / VI equivalent.
  - **maturity** at its hour, for deposits whose maturity date (start_date + term_months) is tomorrow: "{name} matures tomorrow ({amount})".
  - **Auto snapshot**: in the first hour of a new local month (local hour 0, day 1), upsert the previous month's snapshot (net worth, FI assets, salary as income, actual spending from transactions).
- Delivery: insert a row in `notifications`, then send a **payload-less Web Push** to every subscription: `POST endpoint` with headers `TTL: 86400`, `Urgency: normal`, `Authorization: vapid t=<JWT>, k=<VAPID_PUBLIC_KEY>`; JWT ES256 (WebCrypto, `aud` = endpoint origin, `exp` = now+12h, `sub` = VAPID_SUBJECT). Delete subscriptions that return 404/410.
- Service worker on `push`: fetch `/api/notifications/latest` (credentials include), show notification in the user's locale (read from the response's `locale` field), fallback text if fetch fails; `notificationclick` focuses/opens `url` (default `/`).
- iOS: push works only after "Add to Home Screen" (iOS 16.4+); the UI explains this when `Notification` is unavailable.

## UX (B) — principle: fewest taps

Layout: mobile-first; bottom tab bar on phones (Home, Spend, Plan, Assets, Settings), left sidebar on ≥ 900px. A floating **+** button on every screen opens **Quick add**.

- **Login**: one passcode field (numeric keypad on mobile), autofocus, submit on Enter. Remembered for a year.
- **Quick add** (the most-used flow, target ≤ 3 taps + typing): bottom sheet with a large amount display and custom numpad (0–9, 000, ⌫), quick chips `+50k +100k +200k +500k`; category chips (last-used first, preselected); optional note; date defaults to today (tap to change). Save → haptic-like pulse, toast "Saved" with Undo (5 s). Offline: queue in `localStorage` outbox and flush when online; show a small "pending" badge.
- **Home (dashboard)**:
  1. Hero: animated circular progress ring to the FI target (count-up %), with "FI target 9,06 tỷ", "Còn thiếu 8,68 tỷ", expected FI date.
  2. KPI cards (count-up): Net worth, FI assets, Passive income / month with a coverage bar (% of spending covered), Savings rate.
  3. This month: actual vs planned spending gauge/bar, days left, top categories donut (d3), today's total.
  4. Projection chart (d3 area + line): projected FI assets for 20 years at current saving, dashed target line, highlighted crossing point with label "FI ~2040"; animated draw on load; tap/hover tooltip.
  5. Plans: one card per horizon (5y, 10y): required saving / month vs current, gap (red if positive, green "On track" if 0).
  6. Upcoming: deposits maturing in the next 30 days.
- **Spend**: month switcher (‹ Nov 2026 ›), total vs plan, daily bar chart for the month, list grouped by day with swipe/long-press to delete and tap to edit (same sheet as Quick add).
- **Plan (what-if)**: sliders/steppers for expected return (0–15%, 0.1 step), target multiple (10–50), horizons, salary; spending items editable inline (name, amount, month/year toggle, add/remove). Every change recomputes the summary live (client-side with `calc.ts`) and shows the delta vs saved values; **Save** persists, **Reset** discards.
- **Assets**: grouped by type with subtotals and a stacked bar of allocation; tap a row → edit sheet (fields depend on type: stock = quantity + price; deposit = amount, rate, start date, term → shows maturity); toggle "Counts toward FI". "Update prices" mode: all stock prices editable in one list, save once.
- **Settings**: language toggle EN/VI (instant), reminders (toggle + hour per reminder), "Enable notifications" button + "Send test", categories (add/rename/recolor/archive), Export JSON / CSV of transactions, Import JSON, Log out, app version.
- **History**: month snapshots line chart (net worth & FI assets) reachable from Home ("View history").

Visual style: dark (#0B0F17 background, surfaces #121826/#1A2233, borders rgba(255,255,255,.06)), accent gradient emerald→cyan (#10B981→#22D3EE) for progress, warning amber #F59E0B, danger rose #F43F5E; Inter/system font stack; rounded 16px cards, soft shadows, subtle glassy blur on sheets and nav; 150–300ms ease-out transitions; respect `prefers-reduced-motion`. Large numbers use `formatCompact` with full value in a tooltip/secondary line. Safe-area insets for iPhone. Skeleton shimmer while loading.

PWA: `manifest.webmanifest` (name "My Finance", short_name "Finance", display standalone, theme/background #0B0F17, icons 192/512 + maskable, generated as PNG at build or committed SVG→PNG via `sharp` if available — SVG icon is acceptable fallback), SW caches the app shell (cache-first, versioned) and `/api/state` (network-first, fall back to cache so the dashboard works offline).
