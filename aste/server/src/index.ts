import { Redis } from 'ioredis';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { createMailer } from './services/mailer.js';
import { createLocalStorage, createS3Storage } from './services/storage.js';
import { createStripeProvider, FakePaymentProvider } from './services/payments.js';
import { createLocalBus, createRedisBus } from './services/events.js';
import { createExpoPushSender } from './services/push.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const log = pino({ level: 'info' });
const db = createPool(config.DATABASE_URL);
await migrate(db);

const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 }) : undefined;
const payments = config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
  ? createStripeProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET)
  : new FakePaymentProvider();
if (payments instanceof FakePaymentProvider) log.warn('Stripe non configurato: pagamenti simulati (solo sviluppo)');

const app = await buildApp({
  config,
  db,
  clock: () => new Date(),
  mailer: createMailer(config.SMTP_URL, config.MAIL_FROM, log),
  storage: config.S3_BUCKET && config.S3_PUBLIC_BASE_URL
    ? createS3Storage({ bucket: config.S3_BUCKET, region: config.S3_REGION, endpoint: config.S3_ENDPOINT, publicBaseUrl: config.S3_PUBLIC_BASE_URL })
    : createLocalStorage(config.UPLOAD_DIR, config.API_URL ?? `http://localhost:${config.PORT}`),
  payments,
  bus: config.REDIS_URL ? createRedisBus(config.REDIS_URL) : createLocalBus(),
  push: createExpoPushSender(config.EXPO_ACCESS_TOKEN),
  redis,
});

const stopJobs = startJobs(app);
await app.listen({ port: config.PORT, host: '0.0.0.0' });

// Arresto ordinato: smette di accettare richieste, completa quelle in corso, chiude le connessioni.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'arresto in corso');
    stopJobs();
    await app.close();
    await app.deps.bus.close();
    await redis?.quit();
    await db.end();
    process.exit(0);
  });
}
