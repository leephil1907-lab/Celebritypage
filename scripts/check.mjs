/**
 * scripts/check.mjs — the pre-flight gate.
 * Static integrity for a project that is mostly templates + hand-written JS:
 *   1. every server/client module parses
 *   2. every EJS view compiles
 *   3. every include() target exists (EJS resolves relative to the including file)
 *   4. no inline event handlers slipped into markup (CSP is script-src 'self')
 *   5. every /api/… path the client calls exists on the router
 *   6. built assets exist, are non-empty and are newer than their sources
 *   7. if a server answers on :8000, every route still renders without an error
 *   8. the file trace a Vercel function would get is complete (templates, engine, native binding)
 * Exits non-zero on the first problem class found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const f = path.join(dir, d.name);
  if (d.isDirectory()) return walk(f, re);
  return re.test(d.name) ? [f] : [];
}) : []);

const problems = [];
const note = (msg) => { problems.push(msg); console.log('  ✗ ' + msg); };
const rel = (f) => path.relative(ROOT, f);
let checks = 0;
let liveSkipped = false;
const pass = (label) => { checks++; if (process.env.CHECK_VERBOSE) console.log(`  ✓ ${label}`); };

console.log('\ncelebritypage — integrity check\n' + '='.repeat(38));

/* ---------- 1. parse every module ---------- */
console.log('\n[1] syntax');
const jsFiles = [...walk(path.join(ROOT, 'server'), /\.js$/), ...walk(path.join(ROOT, 'client'), /\.js$/), ...walk(path.join(ROOT, 'scripts'), /\.mjs$/), 'tests/app.test.mjs'].filter((f) => typeof f === 'string');
for (const f of jsFiles) {
  const file = path.resolve(f);
  const asMjs = file.endsWith('.mjs');
  try {
    execFileSync(process.execPath, asMjs ? ['--input-type=module', '--check'] : ['--check', file], { cwd: ROOT, stdio: 'pipe', input: asMjs ? fs.readFileSync(file) : undefined });
    pass(rel(file));
  } catch (e) { note(`${rel(file)}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')}`); }
}
console.log(`  ${jsFiles.length - problems.length}/${jsFiles.length} modules parse`);

/* ---------- 2 + 3. compile views, resolve includes ---------- */
console.log('\n[2] views');
const views = walk(path.join(ROOT, 'views'), /\.ejs$/);
const includeRe = /include\(\s*'([^']+)'/g;
let includeCount = 0;
for (const f of views) {
  const src = fs.readFileSync(f, 'utf8');
  try { ejs.compile(src, { filename: f }); pass(rel(f)); }
  catch (e) { note(`${rel(f)}: ${e.message.split('\n')[0]}`); continue; }
  for (const m of src.matchAll(includeRe)) {
    includeCount++;
    const target = m[1];
    if (target.includes('<%')) continue;                       // dynamic (layout body) — checked by the render sweep
    const resolved = path.resolve(path.dirname(f), target + '.ejs');
    if (!fs.existsSync(resolved)) note(`${rel(f)}: include('${target}') does not exist`);
  }
}
console.log(`  ${views.length} templates compiled, ${includeCount} includes resolved`);

/* ---------- 4. inline handlers under a strict CSP ---------- */
console.log('\n[3] markup hygiene');
const htmlSources = [...views, ...walk(path.join(ROOT, 'public'), /\.html$/)];
let inline = 0;
for (const f of htmlSources) {
  const src = fs.readFileSync(f, 'utf8');
  const hits = [...src.matchAll(/\son(click|error|load|mouse\w+|key\w+|focus|blur|submit|input|change)\s*=\s*["'][^"']{2,}/g)]
    .filter((m) => !/^\s*$/.test(m[0]) && !m[0].includes('<%'));
  inline += hits.length;
  hits.forEach((h) => note(`${rel(f)}: inline handler ${h[0].slice(0, 46)}…`));
}
if (!inline) console.log(`  no inline event handlers in ${htmlSources.length} sources`);

/* ---------- 5. client API calls vs server routes ---------- */
console.log('\n[4] API contract');
const appSrc = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'server/admin.js'), 'utf8');
const routes = new Set();
for (const src of [appSrc, adminSrc]) {
  for (const m of src.matchAll(/\.(get|post|put|delete)\(\s*'(\/[^']+)'/g)) routes.add(m[2]);
}
const shaped = new Set([...routes].map((r) => r.replace(/:[a-zA-Z]+/g, '§')));
const apiRe = /Site\.api\(\s*[`'"]([a-z0-9/_-]+)/gi;
let calls = 0; let missing = 0;
for (const f of walk(path.join(ROOT, 'client'), /\.js$/)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/api\(\s*[`'"]([a-z0-9/_${}-]+)/gi)) {
    const raw = m[1];
    if (raw.includes('${')) { calls++; continue; }               // dynamic suffix — covered by tests
    const pathName = '/' + raw.replace(/^\/?api\//, '').split('?')[0];
    const candidate = '/api' + pathName;
    const adminCandidate = pathName;
    calls++;
    const hit = shaped.has(candidate.replace(/[a-z0-9-]+$/i, '§')) || [...shaped].some((r) => r === candidate || r === adminCandidate || r === '/api' + adminCandidate);
    if (!hit) { missing++; note(`${rel(f)}: ${candidate} has no matching route`); }
  }
}
console.log(`  ${calls} client API calls checked, ${missing} unresolved`);

/* ---------- 6. build freshness ---------- */
console.log('\n[5] assets');
const pairs = [
  ['public/js/app.js', ['client/app.js', 'client/carousel.js', 'client/motion.js', 'client/site.js']],
  ['public/js/admin.js', ['client/admin.js']],
  ['public/css/app.css', ['public/css/site.css', 'client/css/app.css']],
  ['public/css/admin.css', ['client/css/admin.css']],
];
for (const [out, srcs] of pairs) {
  const op = path.join(ROOT, out);
  if (!fs.existsSync(op)) { note(`${out} is missing — run npm run build`); continue; }
  const stat = fs.statSync(op);
  if (stat.size < 800) note(`${out} is suspiciously small (${stat.size} bytes)`);
  const stale = srcs.filter((s) => fs.existsSync(path.join(ROOT, s)) && fs.statSync(path.join(ROOT, s)).mtimeMs > stat.mtimeMs);
  if (stale.length) note(`${out} is stale — rebuilt needed after ${stale.map(rel).join(', ')}`);
  else pass(out);
}
if (!problems.length) console.log('  built assets present and fresher than their sources');

/* ---------- 7. optional live sweep ---------- */
console.log('\n[6] live routes');
const base = process.env.CHECK_BASE || 'http://127.0.0.1:8000';
const pages = ['/', '/work/', '/music/', '/tour/', '/journal/', '/journal/1', '/archive/', '/members/', '/shop/', '/shop/verify', '/search/?q=tour', '/support/', '/join/', '/nope-404', '/healthz', '/api/section/hero'];
let live = 0;
try {
  const probe = await fetch(base + '/healthz', { signal: AbortSignal.timeout(1200) });
  if (!probe.ok) throw new Error('healthz ' + probe.status);
  for (const p of pages) {
    try {
      const r = await fetch(base + p, { signal: AbortSignal.timeout(4000) });
      const t = await r.text();
      const want = p === '/nope-404' ? 404 : 200;
      if (r.status !== want) { note(`${p} → ${r.status} (expected ${want})`); continue; }
      if (/is not defined|Cannot read|ReferenceError|Could not find the include/.test(t)) { note(`${p} rendered a template error`); continue; }
      live++;
    } catch (e) { note(`${p} request failed: ${e.message}`); }
  }
  console.log(`  ${live}/${pages.length} routes rendered on ${base}`);
} catch (e) {
  console.log(`  skipped — no server answering on ${base} (${e.message.split('\n')[0]}); start it with npm run dev`);
  liveSkipped = true;
}

/* ---------- the feed the <head> promises ---------- */
try {
  const feed = await (await fetch(base + '/rss.xml', { signal: AbortSignal.timeout(4000) })).text();
  const okXml = feed.startsWith('<?xml') && /<rss version="2\.0"/.test(feed) && feed.trim().endsWith('</rss>');
  if (!okXml) note('/rss.xml is not a well-formed RSS document');
  const items = (feed.match(/<item>/g) || []).length;
  if (!items) note('/rss.xml lists no entries');
  const links = [...feed.matchAll(/<(?:link|guid)[^>]*>([^<]+)</g)].map((m) => m[1]);
  const sloppy = links.filter((l) => !/^https?:\/\/[^/]+\/[^<]*$/.test(l) || /__|undefined|localhost:\d{4,5}/.test(l));
  if (sloppy.length) note(`/rss.xml has ${sloppy.length} unusable link(s): ${sloppy.slice(0, 2).join(' ')}`);
  if (okXml && items && !sloppy.length) { checks += 3; console.log(`  rss: ${items} entries, ${links.length} links, all absolute`); }
} catch (e) {
  console.log(`  rss: skipped (${e.message.split('\n')[0]})`);
}

/* ---------- 8. the deploy bundle is whole ----------
 * A Vercel function is only ever given the files `@vercel/nft` can prove it reads. Templates loaded
 * by path, the engine express asks for by string, the native SQLite binding — any of them missing is
 * a 500 on the deploy host and a green light locally, so the trace is measured here, before that. */
console.log('\n[7] deploy bundle');
{
  let bad = 0;
  try {
    const { nodeFileTrace } = await import('@vercel/nft');
    const entry = path.join(ROOT, 'api', 'index.js');
    if (!fs.existsSync(entry)) { note('api/index.js — the Vercel entry point — does not exist'); bad++; }
    const traced = new Set((await nodeFileTrace([entry], { base: ROOT })).fileList);

    const lostViews = views.map((f) => rel(f)).filter((v) => !traced.has(v));
    if (lostViews.length) { note(`${lostViews.length} template(s) are not in the deploy trace: ${lostViews.slice(0, 3).join(' ')}`); bad++; }
    else pass('every template is in the deploy trace');

    for (const [f, why] of [
      ['node_modules/ejs/lib/ejs.js', 'express reaches the engine by string, which only a registered engine makes visible'],
      ['public/build.json', 'the asset fingerprint the <head> asks for on every page'],
    ]) {
      if (!traced.has(f)) { note(`${f} is not in the deploy trace — ${why}`); bad++; } else pass(`${f} traced`);
    }

    const native = [...traced].filter((f) => f.endsWith('.node'));
    if (!native.some((f) => f.includes('better-sqlite3'))) { note('no better-sqlite3 binding in the deploy trace — open() would fail on the host'); bad++; }
    else pass('the native SQLite binding is traced');

    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const fn = (cfg.functions || {})['api/index.js'];
    if (!fn) { note('vercel.json says nothing about api/index.js — maxDuration/includeFiles belong to that function'); bad++; }
    else {
      if (!(fn.maxDuration > 0)) { note('vercel.json: the function needs a maxDuration'); bad++; } else pass('function maxDuration set');
      // Vercel's published schema is strict here: a single glob string, not an array
      if (typeof fn.includeFiles !== 'string' || !fn.includeFiles.length) { note(`vercel.json: functions["api/index.js"].includeFiles must be a glob string (Vercel rejects an array), got ${JSON.stringify(fn.includeFiles)}`); bad++; }
      else if (!fs.existsSync(path.join(ROOT, fn.includeFiles.replace(/\/\*\*$/, '')))) { note(`vercel.json: includeFiles "${fn.includeFiles}" does not point at a directory in the repo`); bad++; }
      else pass('function includeFiles is a glob over a real directory');
      if (fn.runtime && !/^nodejs(18|20|22|x)/.test(fn.runtime)) note(`vercel.json: runtime "${fn.runtime}" is not a Node runtime this app knows how to serve`);
      const keys = new Set(Object.keys(cfg));
      const known = new Set(['$schema', 'framework', 'buildCommand', 'installCommand', 'devCommand', 'outputDirectory', 'functions', 'rewrites', 'redirects', 'headers', 'cleanUrls', 'trailingSlash', 'crons', 'regions', 'public', 'assets', 'builds', 'routes', 'mounts', 'maximumNowNextRequests']);
      const unknown = [...keys].filter((k) => !known.has(k));
      if (unknown.length) { note(`vercel.json has keys Vercel does not accept: ${unknown.join(' ')}`); bad++; }
      else pass('every vercel.json key is one Vercel accepts');
      for (const [k, v] of Object.entries(cfg)) {
        if (k === 'functions' || k === '$schema') continue;
        const t = typeof v;
        if (k === 'framework') continue;
        if (!(t === 'string' || Array.isArray(v))) { note(`vercel.json: "${k}" should be a string or an array, got ${t}`); bad++; }
      }
    }
    if (cfg.buildCommand) {
      const build = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
      if (!/esbuild is not installed/.test(build)) { note('npm run build is the install/build hook but does not survive a production install without esbuild'); bad++; }
      else pass('the build tolerates a production install (no esbuild)');
    }
    if (!cfg.outputDirectory || !fs.existsSync(path.join(ROOT, cfg.outputDirectory))) { note(`vercel.json outputDirectory "${cfg.outputDirectory}" is not a directory in the repo`); bad++; }
    else pass('outputDirectory exists');

    /* the ignore list is allowed to hide state and tooling, never the code the function reads */
    const igFile = path.join(ROOT, '.vercelignore');
    if (!fs.existsSync(igFile)) { note('.vercelignore is missing — the deploy would ship the dev database and every screenshot'); bad++; }
    else {
      const ig = fs.readFileSync(igFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\/+$/, '').replace(/^\/+/, ''));
      const needed = ['views', 'server', 'client', 'public', 'api', 'package.json', 'package-lock.json'];
      const blocked = ig.filter((g) => needed.includes(g));
      if (blocked.length) { note(`.vercelignore hides source the deploy needs: ${blocked.join(' ')}`); bad++; }
      else pass(`${ig.length} ignored paths, none of them source`);
      const mustHide = ['data', 'uploads', '.git', 'qa'];
      const leaking = mustHide.filter((g) => !ig.includes(g));
      if (leaking.length) { note(`.vercelignore should keep ${leaking.join(', ')} out of the deploy`); bad++; }
      else pass('state, git and dependencies stay out of the deploy');
    }

    const rewrites = cfg.rewrites || [];
    for (const rw of rewrites) {
      const dest = String(rw.destination || '').replace(/^\//, '');
      if (!fs.existsSync(path.join(ROOT, dest)) && !fs.existsSync(path.join(ROOT, `${dest}.js`))) { note(`vercel.json rewrite targets ${rw.destination}, which is not in the repo`); bad++; }
    }
    if (!bad) console.log(`  ${traced.size} files traced for the function · ${views.length} templates · ${native.length} native binding(s) · ${rewrites.length} rewrite(s)`);
  } catch (e) {
    note(`the deploy-bundle check could not run: ${e.message.split('\n')[0]}`);
    console.log('  ✗ this stage is not optional — install its dev dependency (`npm i -D @vercel/nft`)');
  }
}

console.log('\n[8] deploy contract');
{
  let bad = 0;
  /* Every variable the app can be configured with has to be documented, and the documentation has to
     describe a variable the app actually reads — a deploy checklist that drifts from the code is
     worse than none, because it is believed. */
  const read = new Set();
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data', 'uploads'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (/\.(mjs|js|ejs|json)$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const sources = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'tests'))]
    .filter((f) => !f.includes(path.sep + 'scripts' + path.sep + 'lib' + path.sep));
  for (const f of sources) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[['"]([A-Z0-9_]+)['"]\])/g)) read.add(m[1] || m[2]);
  }
  const exampleFile = path.join(ROOT, '.env.example');
  if (!fs.existsSync(exampleFile)) { note('.env.example is missing — a deployment has no documented contract'); bad++; }
  else {
    const body = fs.readFileSync(exampleFile, 'utf8');
    const documented = new Set([...body.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const undocumented = [...read].filter((k) => !documented.has(k)).sort();
    const unused = [...documented].filter((k) => !read.has(k)).sort();
    if (undocumented.length) { note(`.env.example does not document ${undocumented.join(', ')} — a deploy would guess`); bad++; }
    else pass(`every one of the ${read.size} variables the code reads is documented`);
    if (unused.length) { note(`.env.example documents ${unused.join(', ')}, which no code reads`); bad++; }
    else pass('and .env.example documents nothing the code ignores');
    const blanks = [...body.matchAll(/^([A-Z0-9_]+)=(\S+)$/gm)].filter((m) => /PASSWORD|SECRET|TOKEN|KEY/.test(m[1]));
    if (blanks.length) { note(`.env.example ships a value for ${blanks.map((m) => m[1]).join(', ')} — secrets belong in the host`); bad++; }
    else pass('no secret is pre-filled in .env.example');
  }

  /* The container/disk path is the one that keeps data, so its mount has to line up with the code. */
  const renderFile = path.join(ROOT, 'render.yaml');
  if (!fs.existsSync(renderFile)) { note('render.yaml is missing — the durable deploy path is undocumented'); bad++; }
  else {
    const yaml = fs.readFileSync(renderFile, 'utf8');
    const mount = /mountPath:\s*(\S+)/.exec(yaml)?.[1];
    const dataDir = /key:\s*DATA_DIR\s*\n\s*value:\s*(\S+)/.exec(yaml)?.[1];
    const health = /healthCheckPath:\s*(\S+)/.exec(yaml)?.[1];
    if (!mount || !dataDir || dataDir !== mount) { note(`render.yaml must point DATA_DIR at the mounted disk (mount ${mount || '?'} vs DATA_DIR ${dataDir || '?'})`); bad++; }
    else pass(`the disk at ${mount} is where state is written`);
    const uploads = /key:\s*UPLOAD_DIR\s*\n\s*value:\s*(\S+)/.exec(yaml)?.[1];
    if (!uploads || !uploads.startsWith(mount)) { note(`render.yaml must keep UPLOAD_DIR (${uploads || 'unset'}) inside the mounted disk`); bad++; }
    else pass('uploads stay on the same disk');
    if (!health) { note('render.yaml has no health check'); bad++; }
    else {
      const appJs = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8');
      const registered = appJs.includes("'" + health + "'") || appJs.includes('"' + health + '"');
      if (!registered) { note(`render.yaml health-checks ${health}, which the app does not serve`); bad++; }
      else pass(`health check ${health} is a route the app answers`);
    }
    const passwords = [...yaml.matchAll(/key:\s*(ADMIN_PASSWORD|SEED_DEMO_PASSWORD)\s*\n(?:\s+.*\n)*?\s+value:/g)];
    if (passwords.length) { note('render.yaml must not carry a password value — use sync: false'); bad++; }
    else pass('the blueprint asks for secrets instead of storing them');
  }

  /* Docker is the other durable path: the image must run in production mode with a writable data dir. */
  const dockerFile = path.join(ROOT, 'Dockerfile');
  if (fs.existsSync(dockerFile)) {
    const docker = fs.readFileSync(dockerFile, 'utf8');
    const pr = /NODE_ENV=production/.test(docker);
    pr ? pass('the image runs production mode') : (note('the Dockerfile never sets NODE_ENV=production, so demo accounts stay open in the image'), bad++);
    const runs = /CMD|ENTRYPOINT/.test(docker);
    runs ? pass('the image declares how to start') : (note('the Dockerfile has no CMD'), bad++);
    /* A native dependency whose binary arrives through an install script is dead weight if the
       install step is told to ignore scripts: the image builds, and the container cannot open its
       database. This shipped once — the check now refuses it. */
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    const natives = deps.filter((d) => fs.existsSync(path.join(ROOT, 'node_modules', d, 'binding.gyp')));
    const install = /npm (ci|install)[^\n]*/.exec(docker)?.[0] || '';
    if (natives.length && /--ignore-scripts/.test(install) && !/--ignore-scripts[^\n]*\n[^\n]*npm rebuild/.test(docker)) {
      note(`the Dockerfile installs with --ignore-scripts, so ${natives.join(', ')} would ship without its native binary (the container boots into a dead database)`);
      bad++;
    } else if (natives.length) {
      pass(`the image keeps install scripts on, so ${natives.join(', ')} gets its binary`);
    }
  } else { note('Dockerfile is missing'); bad++; }
}

/* ---------- verdict ---------- */
const unique = [...new Set(problems)];
console.log('\n' + '='.repeat(38));
if (unique.length) {
  console.log(`FAIL — ${unique.length} problem(s), ${checks} checks passed\n`);
  unique.slice(0, 40).forEach((p) => console.log('  · ' + p));
  process.exit(1);
} else {
  console.log(`PASS — ${checks} checks, ${views.length} templates, ${calls} API calls`
    + (liveSkipped ? ', live route sweep SKIPPED (no server on ' + base + ')' : `, ${pages.length} routes swept`) + '\n');
}
