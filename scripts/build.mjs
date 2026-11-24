// Builds the web bundle, static assets and the Worker into dist/.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_WEB = path.join(ROOT, 'src/web');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_OUT = path.join(DIST, 'public');

const version = new Date().toISOString();
const define = {
  __APP_VERSION__: JSON.stringify(version),
  'process.env.NODE_ENV': '"production"',
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_OUT, { recursive: true });

// 1. Web app
await esbuild.build({
  entryPoints: [path.join(SRC_WEB, 'main.tsx')],
  outfile: path.join(PUBLIC_OUT, 'app.js'),
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define,
  logLevel: 'warning',
});

// 2. Styles (optional until the UI agent adds them)
const css = path.join(SRC_WEB, 'styles.css');
if (fs.existsSync(css)) fs.copyFileSync(css, path.join(PUBLIC_OUT, 'app.css'));

// 3. HTML shell and static assets (manifest, icons, ...)
fs.copyFileSync(path.join(SRC_WEB, 'index.html'), path.join(PUBLIC_OUT, 'index.html'));
const publicDir = path.join(SRC_WEB, 'public');
if (fs.existsSync(publicDir)) fs.cpSync(publicDir, PUBLIC_OUT, { recursive: true });

// 4. Service worker (optional)
const sw = path.join(SRC_WEB, 'sw.ts');
if (fs.existsSync(sw)) {
  await esbuild.build({
    entryPoints: [sw],
    outfile: path.join(PUBLIC_OUT, 'sw.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    define,
    logLevel: 'warning',
  });
}

// 5. Worker entry
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/worker/index.ts')],
  outfile: path.join(DIST, 'worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  define,
  logLevel: 'warning',
});

const expected = ['public/index.html', 'public/app.js', 'worker.js'];
for (const rel of expected) {
  if (!fs.existsSync(path.join(DIST, rel))) throw new Error(`Build output missing: dist/${rel}`);
}
console.log(`Built My Finance ${version} -> dist/ (worker.js, public/)`);
