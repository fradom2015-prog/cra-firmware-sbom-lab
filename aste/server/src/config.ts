import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
const optional = z.string().trim().transform((v) => (v === '' ? undefined : v)).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  // Indirizzo della web app: link nelle email e ritorno dalla verifica Stripe.
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  // Indirizzo pubblico di questo server API (immagini in sviluppo, senza S3).
  API_URL: z.url().optional(),
  CORS_ORIGINS: z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  TRUST_PROXY: bool.default(false),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optional,
  SELLER_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  BUYER_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  PAYMENT_DUE_DAYS: z.coerce.number().int().min(1).default(3),
  AUTO_RELEASE_DAYS: z.coerce.number().int().min(3).default(14),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  S3_BUCKET: optional,
  S3_REGION: z.string().default('eu-south-1'),
  S3_ENDPOINT: optional,
  S3_PUBLIC_BASE_URL: optional,
  UPLOAD_DIR: z.string().default('uploads'),
  SMTP_URL: optional,
  MAIL_FROM: z.string().default('Aste <no-reply@example.com>'),
  EXPO_ACCESS_TOKEN: optional,
  PWNED_PASSWORD_CHECK: bool.default(false),
  TERMS_VERSION: z.string().default('2026-10'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configurazione non valida:\n${z.prettifyError(parsed.error)}`);
  }
  const c = parsed.data;
  // In produzione niente scorciatoie di sviluppo: servizi reali obbligatori.
  if (c.NODE_ENV === 'production') {
    const missing = (['REDIS_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'S3_BUCKET', 'S3_PUBLIC_BASE_URL', 'SMTP_URL'] as const)
      .filter((k) => !c[k]);
    if (missing.length) throw new Error(`In produzione mancano: ${missing.join(', ')}`);
    if (!c.PUBLIC_URL.startsWith('https://')) throw new Error('In produzione PUBLIC_URL deve usare https');
  }
  return c;
}
