import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { AppError } from './errors.js';
import * as auth from './auth.js';
import * as auctions from './auctions.js';

const PUBLIC_DIR = new URL('../public/', import.meta.url);
// Solo questi file statici sono serviti: niente path traversal possibile.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
const MAX_BODY = 16 * 1024;
const COOKIE = 'sid';

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  // Richiedere JSON blocca anche i form cross-site (CSRF), che non possono inviare application/json.
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new AppError(415, 'Content-Type deve essere application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError(413, 'Richiesta troppo grande');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new AppError(400, 'JSON non valido');
  }
}

export function createServer(db, { now = Date.now, secureCookies = false } = {}) {
  const clients = new Set();

  function broadcast(type, data) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function sessionCookie(token, maxAge) {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  }

  function requireUser(ctx) {
    if (!ctx.user) throw new AppError(401, 'Devi accedere per continuare');
    return ctx.user;
  }

  const routes = [
    ['POST', /^\/api\/register$/, async (ctx) => {
      const user = auth.register(db, await readJson(ctx.req), now());
      const { token, maxAgeSeconds } = auth.createSession(db, user.id, now());
      send(ctx.res, 201, { user }, { 'Set-Cookie': sessionCookie(token, maxAgeSeconds) });
    }],
    ['POST', /^\/api\/login$/, async (ctx) => {
      const user = auth.login(db, await readJson(ctx.req));
      const { token, maxAgeSeconds } = auth.createSession(db, user.id, now());
      send(ctx.res, 200, { user }, { 'Set-Cookie': sessionCookie(token, maxAgeSeconds) });
    }],
    ['POST', /^\/api\/logout$/, async (ctx) => {
      auth.destroySession(db, ctx.token);
      send(ctx.res, 204, undefined, { 'Set-Cookie': sessionCookie('', 0) });
    }],
    ['GET', /^\/api\/me$/, async (ctx) => send(ctx.res, 200, { user: ctx.user })],
    ['GET', /^\/api\/auctions$/, async (ctx) => {
      const status = ctx.url.searchParams.get('status') === 'closed' ? 'closed' : 'open';
      send(ctx.res, 200, { auctions: auctions.listAuctions(db, { status }, now()) });
    }],
    ['POST', /^\/api\/auctions$/, async (ctx) => {
      const user = requireUser(ctx);
      const auction = auctions.createAuction(db, user.id, await readJson(ctx.req), now());
      broadcast('auction', auction);
      send(ctx.res, 201, { auction });
    }],
    ['GET', /^\/api\/auctions\/(\d+)$/, async (ctx, id) => {
      send(ctx.res, 200, { auction: auctions.getAuction(db, id, now()), bids: auctions.listBids(db, id) });
    }],
    ['POST', /^\/api\/auctions\/(\d+)\/bids$/, async (ctx, id) => {
      const user = requireUser(ctx);
      const { amount } = await readJson(ctx.req);
      const auction = auctions.placeBid(db, id, user.id, amount, now());
      const bids = auctions.listBids(db, id);
      broadcast('bid', { auction, bid: bids[0] });
      send(ctx.res, 201, { auction, bids });
    }],
    ['GET', /^\/api\/events$/, async (ctx) => {
      ctx.res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      ctx.res.write('retry: 3000\n\n');
      clients.add(ctx.res);
      ctx.req.on('close', () => clients.delete(ctx.res));
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
        return res.end(readFileSync(new URL(file, PUBLIC_DIR)));
      }
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const ctx = { req, res, url, token, user: auth.userFromSession(db, token, now()) };
      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (!m) continue;
        if (req.method !== method) continue;
        return await handler(ctx, ...m.slice(1).map(Number));
      }
      throw new AppError(404, 'Risorsa non trovata');
    } catch (err) {
      if (err instanceof AppError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Errore interno' });
    }
  }

  const server = http.createServer(handle);
  // Commento SSE periodico: evita che proxy e browser chiudano le connessioni inattive.
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);
  heartbeat.unref();
  // Le connessioni SSE non finiscono da sole: vanno chiuse prima, o server.close() resta in attesa.
  const close = server.close.bind(server);
  server.close = (cb) => {
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    return close(cb);
  };
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const db = openDb(process.env.DB_FILE || 'aste.db');
  createServer(db, { secureCookies: process.env.COOKIE_SECURE === '1' })
    .listen(port, () => console.log(`Aste online su http://localhost:${port}`));
}
