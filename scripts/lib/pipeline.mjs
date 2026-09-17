/**
 * scripts/lib/pipeline.mjs — the one definition of what the build produces.
 *
 * scripts/build.mjs runs it; scripts/check.mjs imports the same maps so an "assets are fresh"
 * verdict can never be based on a stale copy of the file list (that drift is how a bundle ships
 * without a module in it).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CSS_SOURCES = {
  /* @font-face first: the generated font sheet must be declared before the rules that use it */
  'public/css/app.css': ['public/css/fonts.css', 'public/css/site.css', 'client/css/app.css', 'client/css/components.css'],
  'public/css/admin.css': ['public/css/fonts.css', 'client/css/admin.css'],
};

/* one entry point per bundle; the real source list is discovered by following imports */
export const JS_ENTRIES = {
  'public/js/app.js': 'client/app.js',
  'public/js/admin.js': 'client/admin.js',
};

/** Every module the bundle pulls in, so a new client file can never be left out of the freshness gate. */
export function entrySources(entryPath, ROOT, seen = new Set()) {
  const abs = path.join(ROOT, entryPath);
  if (seen.has(abs) || !fs.existsSync(abs)) return [...seen].map((p) => path.relative(ROOT, p));
  seen.add(abs);
  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    entrySources(path.join(path.dirname(entryPath), m[1]).replace(/\\/g, '/'), ROOT, seen);
  }
  return [...seen].map((p) => path.relative(ROOT, p));
}

/** strip comments + collapse whitespace without touching string contents */
export function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

export const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);

/** sources newer than their output? used by the freshness gate */
export function staleSources(out, srcs, ROOT) {
  const op = path.join(ROOT, out);
  if (!fs.existsSync(op)) return srcs.filter((s) => fs.existsSync(path.join(ROOT, s)));
  const mtime = fs.statSync(op).mtimeMs;
  return srcs.filter((s) => {
    const p = path.join(ROOT, s);
    return fs.existsSync(p) && fs.statSync(p).mtimeMs > mtime;
  });
}
