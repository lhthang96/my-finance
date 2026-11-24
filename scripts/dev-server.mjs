// Local dev server: serves dist/public and runs the Worker's fetch handler for /api/*,
// with env.DB backed by node:sqlite through the D1 shim.
//
// Usage: PORT=8787 npx tsx scripts/dev-server.mjs [--fresh]
// Env: APP_PASSCODE (default 1234), SESSION_SECRET (default dev-secret).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker/index.ts';
import { createD1 } from '../src/worker/d1-shim.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'dist/public');
const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');
const SEED_FILE = path.join(ROOT, 'db/seed.sql');
export const DEFAULT_DB_FILE = path.join(ROOT, '.local-db/dev.sqlite');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Applies db/migrations/*.sql that have not run yet (tracked in d1_migrations).
 * Runs db/seed.sql when the database had no migrations applied before this call.
 */
export function migrate(sqlite, { seed = false } = {}) {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT)',
  );
  const applied = new Set(sqlite.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  const isNew = applied.size === 0;
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      sqlite.exec('COMMIT');
      ran.push(file);
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  }
  const seeded = seed && isNew && fs.existsSync(SEED_FILE);
  if (seeded) sqlite.exec(fs.readFileSync(SEED_FILE, 'utf8'));
  return { ran, seeded };
}

/** Opens (creating if needed) a SQLite database and migrates it. Use ':memory:' for tests. */
export function openDatabase(file = DEFAULT_DB_FILE, { seed = true } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  migrate(sqlite, { seed });
  return sqlite;
}

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/** Serves files from dist/public with SPA fallback to index.html (extensionless paths only). */
async function serveAsset(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return new Response('Not found', { status: 404 });
  }
  let stat = statSafe(file);
  if (!stat || stat.isDirectory()) {
    if (path.extname(rel)) return new Response('Not found', { status: 404 });
    file = path.join(PUBLIC_DIR, 'index.html');
    stat = statSafe(file);
  }
  if (!stat) return new Response('Not built. Run npm run build.', { status: 404 });

  const ext = path.extname(file).toLowerCase();
  const body = request.method === 'HEAD' ? null : fs.readFileSync(file);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    },
  });
}

async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || ['host', 'content-length', 'connection', 'transfer-encoding'].includes(k)) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody && chunks.length ? Buffer.concat(chunks) : undefined,
    duplex: 'half',
  });
}

async function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Starts the dev server. Pass port 0 for an ephemeral port (tests).
 * fresh: delete the database file first and re-seed.
 */
export async function startServer({
  port = Number(process.env.PORT ?? 8787),
  dbPath = DEFAULT_DB_FILE,
  fresh = false,
  passcode = process.env.APP_PASSCODE ?? '1234',
  secret = process.env.SESSION_SECRET ?? 'dev-secret',
} = {}) {
  if (fresh && dbPath !== ':memory:') {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  }
  const sqlite = openDatabase(dbPath, { seed: true });

  const env = {
    DB: createD1(sqlite),
    ASSETS: { fetch: serveAsset },
    APP_PASSCODE: passcode,
    SESSION_SECRET: secret,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
    VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:dev@localhost',
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const server = http.createServer(async (req, res) => {
    try {
      const request = await toRequest(req);
      const url = new URL(request.url);
      const response =
        url.pathname === '/api' || url.pathname.startsWith('/api/')
          ? await worker.fetch(request, env, ctx)
          : await serveAsset(request);
      await sendResponse(res, response);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    db: sqlite,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          sqlite.close();
          resolve();
        });
      }),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = await startServer({ fresh: process.argv.includes('--fresh') });
  console.log(`My Finance dev server: ${server.url}`);
}
