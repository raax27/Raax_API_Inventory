'use strict';
/*
 * Raax API Inventory - static file server (no dependencies).
 *
 * The app keeps its data in the browser, so this server only serves the files in ./public.
 * It is fail-closed: it will not start without an admin password, because the page lists
 * internal API endpoints and must not be reachable anonymously.
 *
 *   ADMIN_PASSWORD   required, 12+ characters (set ALLOW_NO_AUTH=true to run without it on loopback only)
 *   ADMIN_USER       default "admin"
 *   HOST / PORT      default 127.0.0.1 / 8080  (use HOST=0.0.0.0 inside a container)
 *   ALLOWED_HOSTS    optional comma-separated Host header allow-list
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASSWORD || '';
const ALLOW_NO_AUTH = process.env.ALLOW_NO_AUTH === 'true' && ['127.0.0.1', '::1', 'localhost'].includes(HOST);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PUBLIC_DIR = fs.realpathSync(path.join(__dirname, 'public'));

if (!ALLOW_NO_AUTH && PASS.length < 12) {
  console.error('Refusing to start: set ADMIN_PASSWORD to 12 or more characters (see .env.example).');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store',
};

function send(res, status, body, extra) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, HEADERS, extra || {}));
  res.end(body);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const expected = sha(USER + '\0' + PASS);
const fails = new Map();   // ip -> { n, until }

function authorised(req) {
  const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return crypto.timingSafeEqual(sha(decoded.slice(0, i) + '\0' + decoded.slice(i + 1)), expected);
}

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  if (p === '/' || p === '') p = '/index.html';
  const full = path.join(PUBLIC_DIR, path.normalize(p));
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return null;
  const base = path.basename(full);
  if (base.startsWith('.')) return null;                       // never serve dotfiles
  let real;
  try { real = fs.realpathSync(full); } catch (_) { return null; }
  if (!real.startsWith(PUBLIC_DIR + path.sep)) return null;    // symlink escape
  try { if (!fs.statSync(real).isFile()) return null; } catch (_) { return null; }
  return TYPES[path.extname(real).toLowerCase()] ? real : null;
}

const server = http.createServer((req, res) => {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(host)) return send(res, 421, 'Misdirected request');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (_) { return send(res, 400, 'Bad request'); }

    if (pathname === '/healthz') return send(res, 200, 'ok');

    if (!ALLOW_NO_AUTH) {
      const ip = req.socket.remoteAddress || '?';
      const f = fails.get(ip);
      if (f && f.until > Date.now()) return send(res, 429, 'Too many attempts. Try again later.', { 'Retry-After': '300' });
      if (!authorised(req)) {
        const cur = f && f.until === 0 ? f : { n: 0, until: 0 };
        cur.n++;
        if (cur.n >= 10) { cur.until = Date.now() + 5 * 60 * 1000; cur.n = 0; }
        fails.set(ip, cur);
        if (fails.size > 5000) fails.clear();
        return send(res, 401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="Raax API Inventory", charset="UTF-8"' });
      }
      fails.delete(ip);
    }

    const file = resolveFile(pathname);
    if (!file) return send(res, 404, 'Not found');
    const stream = fs.createReadStream(file);
    stream.on('error', () => send(res, 500, 'Server error'));   // a vanished/unreadable file must never crash the process
    stream.on('open', () => {
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file).toLowerCase()] }, HEADERS));
      if (req.method === 'HEAD') { stream.destroy(); res.end(); } else stream.pipe(res);
    });
    res.on('close', () => stream.destroy());
  } catch (e) {
    send(res, 500, 'Server error');
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 50;
server.on('clientError', (_e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });

process.on('SIGTERM', () => server.close(() => process.exit(0)));

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log('Raax API inventory listening on http://' + HOST + ':' + PORT + (ALLOW_NO_AUTH ? ' (NO AUTH, loopback only)' : '')));
}
module.exports = server;
