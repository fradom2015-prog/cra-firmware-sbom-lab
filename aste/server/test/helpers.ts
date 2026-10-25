import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db/pool.js';
import { MemoryMailer } from '../src/services/mailer.js';
import { createLocalStorage } from '../src/services/storage.js';
import { FakePaymentProvider } from '../src/services/payments.js';
import { createLocalBus } from '../src/services/events.js';
import { MemoryPushSender } from '../src/services/push.js';
import { TEST_DB_URL } from './global-setup.js';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  mailer: MemoryMailer;
  payments: FakePaymentProvider;
  push: MemoryPushSender;
  clock: { now: Date; advance(ms: number): void };
}

const pool = createPool(TEST_DB_URL);
afterAll(() => pool.end());

const TABLES = ['audit_log', 'push_tokens', 'payment_events', 'reviews', 'orders', 'reports', 'blocks', 'watchlist', 'bids',
  'auction_images', 'auctions', 'seller_profiles', 'email_tokens', 'sessions', 'users'];

// Un'app nuova per ogni test, su database svuotato e con orologio controllabile.
export function useTestApp(): TestCtx {
  const ctx = {} as TestCtx;
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
    const clock = {
      now: new Date('2026-11-02T10:00:00Z'),
      advance(ms: number) {
        this.now = new Date(this.now.getTime() + ms);
      },
    };
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, PUBLIC_URL: 'http://test.local' });
    const mailer = new MemoryMailer();
    const payments = new FakePaymentProvider();
    const push = new MemoryPushSender();
    const app = await buildApp({
      config, db: pool, clock: () => clock.now, mailer, payments, push, bus: createLocalBus(),
      storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'aste-test-')), config.PUBLIC_URL),
    }, { logger: false });
    Object.assign(ctx, { app, db: pool, mailer, payments, push, clock });
  });
  afterEach(async () => {
    await ctx.app.close();
  });
  return ctx;
}

export async function api(ctx: TestCtx, method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await ctx.app.inject({
    method: method as 'GET',
    url: `/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

export const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

let seq = 0;
export async function createUser(ctx: TestCtx, opts: { verified?: boolean; name?: string; admin?: boolean } = {}) {
  const name = opts.name ?? `utente${++seq}`;
  const email = `${name}@example.com`;
  const password = 'una-password-sicura-123';
  const reg = await api(ctx, 'POST', '/auth/register', { body: { email, password, displayName: name, acceptTerms: true, confirmAdult: true } });
  if (reg.status !== 202) throw new Error(`registrazione fallita: ${JSON.stringify(reg.body)}`);
  if (opts.verified !== false) {
    const token = tokenFrom(ctx.mailer.lastTo(email)!.text);
    await api(ctx, 'POST', '/auth/verify-email', { body: { token } });
  }
  if (opts.admin) await ctx.db.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  const login = await api(ctx, 'POST', '/auth/login', { body: { email, password } });
  const me = await api(ctx, 'GET', '/me', { token: login.body.accessToken });
  return { id: me.body.user.id as string, name, email, password, token: login.body.accessToken as string, refreshToken: login.body.refreshToken as string };
}

export async function makeSeller(ctx: TestCtx, user: { token: string }) {
  await api(ctx, 'PUT', '/me/seller', { token: user.token, body: {
    type: 'private', legalName: 'Mario Rossi', addressLine: 'Via Roma 1', city: 'Milano', postalCode: '20100', country: 'IT',
  } });
  await api(ctx, 'POST', '/me/seller/onboarding', { token: user.token });
  await api(ctx, 'POST', '/me/seller/refresh', { token: user.token });
}

export async function testImage(opts: { gps?: boolean } = {}) {
  let img = sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg();
  if (opts.gps) img = img.withExif({ IFD0: { Make: 'TestCam', Copyright: 'segreto' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 28/1 0/1' } });
  return img.toBuffer();
}

export async function uploadImage(ctx: TestCtx, token: string, auctionId: string, data: Buffer, filename = 'foto.jpg') {
  const boundary = '----asteboundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST', url: `/v1/auctions/${auctionId}/images`, payload,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}

export async function createActiveAuction(ctx: TestCtx, seller: { token: string }, overrides: Record<string, unknown> = {}) {
  const draft = await api(ctx, 'POST', '/auctions', { token: seller.token, body: {
    categorySlug: 'collezionismo', title: 'Orologio da tasca 1920', description: 'Funzionante, revisionato.',
    condition: 'good', startingPrice: 10_000, shippingPrice: 1_000, durationDays: 7, ...overrides,
  } });
  if (draft.status !== 201) throw new Error(JSON.stringify(draft.body));
  await uploadImage(ctx, seller.token, draft.body.auction.id, await testImage());
  const pub = await api(ctx, 'POST', `/auctions/${draft.body.auction.id}/publish`, { token: seller.token });
  if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
  return pub.body.auction;
}

export const bid = (ctx: TestCtx, user: { token: string }, auctionId: string, maxAmount: number, idempotencyKey?: string) =>
  api(ctx, 'POST', `/auctions/${auctionId}/bids`, { token: user.token, body: { maxAmount, ...(idempotencyKey ? { idempotencyKey } : {}) } });

// Nuovo accesso: serve quando un test sposta l'orologio oltre la scadenza del token (15 minuti).
export async function relogin(ctx: TestCtx, user: { email: string; password: string; token: string }) {
  const res = await api(ctx, 'POST', '/auth/login', { body: { email: user.email, password: user.password } });
  user.token = res.body.accessToken;
  return user;
}
