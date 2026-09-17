/**
 * server/lib/http.js — small HTTP helpers: async routing, compression, security headers,
 * asset caching, pjax detection, form parsing.
 */
import zlib from 'node:zlib';

const COMPRESSIBLE = /^(text\/|application\/json|application\/javascript|image\/svg)/;

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https:",
    /* no CDN: the brand faces are vended into public/fonts and inlined, so nothing may reach out */
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
}

/** gzip text responses above a threshold (no deps, honours Accept-Encoding) */
export function gzip(req, res, next) {
  // an SSE stream must be written straight through — buffering it here would stall live updates
  if (/\/events$/.test(req.path) || /text\/event-stream/.test(req.headers.accept || '')) return next();
  if (res.getHeader('Content-Encoding')) return next();          // the host already encoded this response
  const accept = req.headers['accept-encoding'] || '';
  if (!/\bgzip\b/.test(accept) || req.headers['x-pjax'] === 'stream') return next();
  const chunks = [];
  let type = '';
  const end = res.end.bind(res);
  res.write = (chunk, enc) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), enc || 'utf8')); return true; };
  res.end = (chunk, enc) => {
    if (chunk && chunks.length === 0) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), enc || 'utf8'));
    type = String(res.getHeader('Content-Type') || '');
    const body = Buffer.concat(chunks);
    if (body.length > 1400 && COMPRESSIBLE.test(type)) {
      const gz = zlib.gzipSync(body, { level: 5 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(gz.length));
      res.setHeader('Vary', 'Accept-Encoding');
      return end(gz);
    }
    if (body.length) res.setHeader('Content-Length', String(body.length));
    return end(body);
  };
  next();
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function isPjax(req) {
  return req.query._pjax === '1' || req.get('x-pjax') === '1';
}

export function wantsFragment(req) {
  return req.get('x-fragment') === '1' || req.query._fragment === '1';
}

/** parse json + urlencoded bodies without a dependency */
/**
 * Read the request body. The cap is path-aware on purpose: the admin media upload carries a
 * base64 data URL (a 20 MB clip is ~27 MB of text), while every other endpoint stays small.
 * Oversized input answers 413 rather than dropping the socket, so the UI can say something true.
 * NOTE: this is middleware — call it as `app.use(bodyParser)`, never `bodyParser()`.
 */
export function bodyParser(req, res, next) {
  // one request can pass through two apps (the site plus the console mounted under /admin):
  // the stream is single-use, so the body is read once and reused
  if (req.__bodyRead) { next(); return; }
  const MEDIA_ROUTE = /(?:^|\/)api\/(media|upload)$/;
  const limit = MEDIA_ROUTE.test(req.path) ? 28 * 1024 * 1024 : 1e6;
  if (['GET', 'HEAD'].includes(req.method)) { req.body = {}; req.__bodyRead = true; return next(); }
  const type = req.headers['content-type'] || '';
  let raw = '';
  let tooBig = false;
  req.on('data', (c) => { raw += c; if (raw.length > limit) { tooBig = true; req.pause(); } });
  req.on('end', () => {
    if (tooBig) {
      req.__bodyRead = true;
      res.status(413).json({ error: 'too_big', message: `That file is over the ${(limit / 1024 / 1024).toFixed(0)} MB limit.` });
      return;
    }
    try {
      if (type.includes('application/json')) req.body = raw ? JSON.parse(raw) : {};
      else if (type.includes('application/x-www-form-urlencoded')) req.body = Object.fromEntries(new URLSearchParams(raw));
      else if (type.includes('multipart/form-data')) req.body = {}; // admin uses urlencoded forms
      else { try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = { raw }; } }
    } catch { req.body = {}; }
    req.__bodyRead = true;
    next();
  });
  req.on('error', () => { req.__bodyRead = true; next(new Error('body read failed')); });
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return { _raw: s }; } };

export function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
  res.status(404);
  try { return res.render('pages/404', { title: 'Page not found', page: '404' }); } catch { return res.send('<h1>404</h1>'); }
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, '\n  ', err.stack || err.message);
  const payload = { error: err.code || 'server_error', message: status >= 500 ? 'Something went wrong on our side — please retry.' : err.message };
  if (req.path.startsWith('/api/')) return res.status(status).json(payload);
  res.status(status);
  try { return res.render('pages/error', { title: 'Something went wrong', page: 'error', status, message: payload.message }); }
  catch { return res.send(`<h1>${status}</h1><p>${payload.message}</p>`); }
}

/** minimal static file server with strong caching + etag */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.avif': 'image/avif', '.jsonld': 'application/ld+json',
};

export function staticAssets(dir, { maxAge = '1h', immutable = false } = {}) {
  const root = path.resolve(dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (rel.includes('..') || rel.includes('\0')) return res.status(400).end('bad path');
    const file = path.join(root, rel);
    if (!file.startsWith(root)) return next();
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return next();
      const etag = `W/"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', immutable ? `public, max-age=31536000, immutable` : `public, max-age=${maxAge}`);
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range && /^bytes=/.exec(req.headers.range) ? req.headers.range : null;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? Number(m[1]) : 0;
        let end = m && m[2] ? Number(m[2]) : st.size - 1;
        if (!Number.isFinite(start) || start >= st.size || (m && m[2] && end >= st.size) || end < start) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
          return;
        }
        end = Math.min(end, st.size - 1);
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Content-Length': end - start + 1,
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': `public, max-age=${maxAge}`,
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.setHeader('Content-Length', st.size);
      if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  };
}

/**
 * Every POST form in the rendered document gets a hidden _csrf field.
 * The token itself still comes from the session cookie, so this cannot forge anything —
 * it just means a template (or a plain HTML form post from a browser without JS) can never
 * be rejected for a missing token, and no new form has to remember to add one.
 */
export function injectCsrfFields(html, token) {
  if (!token || typeof html !== 'string' || html.indexOf('<form') === -1) return html;
  const field = `<input type="hidden" name="_csrf" value="${token}">`;
  return html.replace(/<form\b[^>]*>/gi, (tag, offset) => {
    if (!/method=["']?post/i.test(tag)) return tag;
    if (/data-no-csrf/i.test(tag)) return tag;
    const end = html.indexOf('</form>', offset + tag.length);
    const body = html.slice(offset + tag.length, end === -1 ? undefined : end);
    if (body.includes('name="_csrf"')) return tag;
    return tag + field;
  });
}

export function formBody(fields, req) {
  const out = {};
  fields.forEach((f) => {
    const v = req.body?.[f.key];
    if (v === undefined) return;
    out[f.key] = f.type === 'number' ? (v === '' || v === null ? null : Number(v))
      : f.type === 'check' ? (v === 'on' || v === '1' || v === 'true' || v === true ? 1 : 0)
      : f.type === 'lines' ? String(v).split('\n').map((s) => s.trim()).filter(Boolean)
      : String(v).trim();
    if (f.type === 'lines') out[f.key] = JSON.stringify(out[f.key]);
  });
  return out;
}
