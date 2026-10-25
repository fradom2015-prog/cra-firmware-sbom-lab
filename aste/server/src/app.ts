import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { AppError } from './lib/errors.js';
import type { Mailer } from './services/mailer.js';
import type { Storage } from './services/storage.js';
import { KEY_RE } from './services/storage.js';
import type { PaymentProvider } from './services/payments.js';
import type { EventBus } from './services/events.js';
import type { PushSender } from './services/push.js';
import { authRoutes, loadUser } from './modules/auth.js';
import { auctionRoutes } from './modules/auctions.js';
import { userRoutes } from './modules/users.js';
import { orderRoutes } from './modules/orders.js';
import { moderationRoutes } from './modules/moderation.js';
import { realtimeRoutes } from './modules/realtime.js';

export interface Deps {
  config: Config;
  db: Db;
  clock: () => Date;
  mailer: Mailer;
  storage: Storage;
  payments: PaymentProvider;
  bus: EventBus;
  push: PushSender;
  redis?: Redis;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      // Mai token, password o cookie nei log.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["stripe-signature"]', '*.password', '*.token', '*.refreshToken'],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });
  app.decorate('deps', deps);
  app.decorateRequest('user', null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: false });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    ...(deps.redis ? { redis: deps.redis, nameSpace: 'aste-rl:' } : {}),
    // Per gli utenti autenticati il limite è per account, altrimenti per IP.
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
    errorResponseBuilder: (_req, ctx) => new AppError(429, 'rate_limited', `Troppe richieste, riprova tra ${Math.ceil(ctx.ttl / 1000)} secondi`),
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  // L'utente va caricato prima del rate limit (che usa il suo id come chiave).
  app.addHook('onRequest', async (req) => {
    req.user = await loadUser(app, req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      const message = e.statusCode === 413 ? 'Richiesta troppo grande' : e.statusCode === 415 ? 'Formato non supportato' : 'Richiesta non valida';
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message } });
    }
    req.log.error({ err }, 'errore non gestito');
    return reply.code(500).send({ error: { code: 'internal', message: 'Errore interno, riprova più tardi' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Risorsa non trovata' } }));

  app.get('/health', { config: { rateLimit: false } }, async () => {
    await deps.db.query('SELECT 1');
    return { status: 'ok' };
  });

  // Solo in sviluppo: immagini servite dal disco locale.
  if (deps.storage.read) {
    const read = deps.storage.read;
    app.get('/media/:dir/:file', async (req, reply) => {
      const { dir, file } = req.params as { dir: string; file: string };
      const key = `${dir}/${file}`;
      if (!KEY_RE.test(key)) throw new AppError(404, 'not_found', 'Immagine non trovata');
      const data = await read(key).catch(() => null);
      if (!data) throw new AppError(404, 'not_found', 'Immagine non trovata');
      return reply.type('image/webp').header('Cache-Control', 'public, max-age=31536000, immutable').send(data);
    });
  }

  await app.register(async (v1) => {
    await v1.register(authRoutes);
    await v1.register(userRoutes);
    await v1.register(auctionRoutes);
    await v1.register(orderRoutes);
    await v1.register(moderationRoutes);
    await v1.register(realtimeRoutes);
  }, { prefix: '/v1' });

  return app;
}
