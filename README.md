# My Finance

A personal finance PWA: track spending, savings and assets, and see how far you are from financial independence (FI). It runs on Cloudflare Workers with D1, installs to your phone or laptop, and works offline for quick adds.

## Screens

- **Home**: FI progress ring, KPIs, this month, category split, projection, upcoming deposit maturities
- **Spend**: entries by day and month, edit or delete, Quick add (FAB, bottom right)
- **Plan**: what-if editor for salary, return, FI multiple, horizons and spending items
- **Assets**: deposits, holdings and loans, with FI-counted flags
- **History**: monthly snapshots of net worth and FI assets
- **Settings**: language (VI/EN), reminders and push, categories, export/import, logout

## Local development

```bash
npm install
npm run dev        # builds, then serves http://localhost:8787
```

- Passcode: `1234` (override with `APP_PASSCODE`)
- Data lives in `.local-db/` (delete the folder to start fresh)
- The first local run also loads `db/seed.sql`, which holds the owner's real starting balances. Edit it before the first run if you want your own numbers.

## Tests

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (node:test)
npm run build       # bundle web app and Worker into dist/
npm run test:e2e    # Playwright browser tests (needs a build first)
```

`test:e2e` uses Chromium. If it is not at the default path, set `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

## Deploy to Cloudflare (free tier)

1. Install dependencies: `npm i`
2. Log in: `npx wrangler login`
3. Create the database: `npx wrangler d1 create my-finance`
   Copy the printed `database_id` into `database_id` in `wrangler.jsonc`.
4. Apply the schema: `npm run db:migrate`
5. (Optional) Edit `db/seed.sql` to your own starting values, then load it: `npm run db:seed`
6. Set the secrets (you will be prompted for each value):
   - `npx wrangler secret put APP_PASSCODE`: the login passcode
   - `npx wrangler secret put SESSION_SECRET`: random 32+ characters, e.g. `openssl rand -base64 32`
   - Push keys: run `npm run vapid`, then `npx wrangler secret put VAPID_PUBLIC_KEY` and `npx wrangler secret put VAPID_PRIVATE_KEY` with the printed values
7. Set `VAPID_SUBJECT` in `wrangler.jsonc` to `mailto:<your email>`
8. Deploy: `npm run deploy`. Wrangler prints your `*.workers.dev` URL.

### Free-tier notes

- Workers: 100,000 requests per day. A personal app uses a small fraction of this.
- D1: 5 GB storage, far more than the app needs.
- Cron: the hourly cron trigger (`triggers.crons` in `wrangler.jsonc`) runs on the free plan. It sends push reminders: daily log, month end, and deposit maturities.

## Install on your devices

- **iPhone (Safari)**: open the URL, tap Share, then Add to Home Screen. To get reminders, open the app and enable notifications in Settings.
- **Android (Chrome)**: open the URL and accept the install prompt (or menu, then Install app). Enable notifications in Settings.
- **Laptop (Chrome or Edge)**: click the install icon in the address bar.

## Backups

Settings, then Export JSON. Keep the file somewhere safe. Import restores from the same file. Export CSV is available for spreadsheets.

## Bank sync

MoMo and VietinBank do not offer a personal API, so there is no automatic import. Record transactions with Quick add (it works offline and syncs later).

Possible future step: a SePay webhook for VietinBank transfers. This is not built.

## Project layout

- `src/web/`: React PWA (pages, components, store, outbox)
- `src/worker/`: Worker API, auth, cron, push
- `src/shared/`: calculations, formatting and translations shared by both
- `db/migrations/`, `db/seed.sql`: D1 schema and seed
- `scripts/`: build, local dev server, VAPID key generator
- `tests/unit/`, `tests/e2e/`: tests
