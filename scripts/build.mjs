/**
 * scripts/build.mjs — asset pipeline.
 *   client/app.js    --esbuild-->  public/js/app.js      (same for client/admin.js)
 *   public/css/*.css + client/css/*.css  -->  public/css/app.css | admin.css
 *   writes public/build.json (build id + content hashes) so cache-busting is real
 *
 * The file map lives in scripts/lib/pipeline.mjs, which scripts/check.mjs also reads.
 * Run with `npm run build`. Safe to run from postinstall: with no esbuild (a production
 * `npm ci --omit=dev`) the committed bundles are kept and CSS is still rebuilt.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CSS_SOURCES, JS_ENTRIES, minifyCss, hashOf } from './lib/pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...p) => path.join(ROOT, ...p);
const started = Date.now();
const BUILD_ID = process.env.BUILD_ID || started.toString(36);

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const write = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return Buffer.byteLength(data);
};

/* Deployment safety: `npm ci --omit=dev` has no esbuild. Keep the committed JS, rebuild CSS anyway. */
let esbuild = null;
try { esbuild = await import('esbuild').then((m) => m.build); }
catch { console.log('[build] esbuild is not installed — keeping the committed JS bundles'); }

const jobs = [];
for (const [out, entry] of Object.entries(JS_ENTRIES)) {
  const name = path.basename(out, '.js');
  const src = P(entry);
  const dest = P(out);
  if (!fs.existsSync(src)) { console.warn(`[build] skip ${src.replace(ROOT + '/', '')} (missing)`); continue; }
  if (!esbuild) {
    if (!fs.existsSync(dest)) {
      console.error(`[build] no esbuild and no committed ${out} — run "npm ci" with dev dependencies`);
      process.exitCode = 1;
    } else {
      console.log(`[build] ${out}  ${(fs.statSync(dest).size / 1024).toFixed(1)} kb (committed, unchanged)`);
    }
    continue;
  }
  jobs.push(esbuild({
    entryPoints: [src],
    outfile: dest,
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: `/* ${name} • build ${BUILD_ID} */` },
  }).then(() => console.log(`[build] ${out}  ${(fs.statSync(dest).size / 1024).toFixed(1)} kb`)));
}

for (const [out, files] of Object.entries(CSS_SOURCES)) {
  const parts = files.map((f) => read(P(f))).filter(Boolean);
  if (!parts.length) { console.warn(`[build] skip ${out} (no sources)`); continue; }
  const bytes = write(P(out), minifyCss(parts.join('\n')));
  console.log(`[build] ${out}  ${(bytes / 1024).toFixed(1)} kb`);
}

const manifest = { build: BUILD_ID, at: new Date().toISOString(), files: {} };
for (const f of [...Object.keys(CSS_SOURCES), ...Object.keys(JS_ENTRIES)]) {
  const fp = P(f);
  if (!fs.existsSync(fp)) continue;
  const buf = fs.readFileSync(fp);
  manifest.files[f] = { bytes: buf.length, hash: hashOf(buf) };
}
write(P('public', 'build.json'), JSON.stringify(manifest, null, 2) + '\n');

await Promise.all(jobs);
console.log(`[build] done in ${Date.now() - started} ms — build ${BUILD_ID}`);
