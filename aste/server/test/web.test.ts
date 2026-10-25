import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { MemoryMailer } from '../src/services/mailer.js';
import { createLocalStorage } from '../src/services/storage.js';
import { FakePaymentProvider } from '../src/services/payments.js';
import { createLocalBus } from '../src/services/events.js';
import { MemoryPushSender } from '../src/services/push.js';
import { TEST_DB_URL } from './global-setup.js';

const db = createPool(TEST_DB_URL);
afterAll(() => db.end());

async function appWith(env: Record<string, string>) {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, API_URL: 'https://aste.example.com', ...env });
  return buildApp({
    config, db, clock: () => new Date(), mailer: new MemoryMailer(), payments: new FakePaymentProvider(), push: new MemoryPushSender(),
    bus: createLocalBus(), storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'aste-web-')), config.PUBLIC_URL),
  }, { logger: false });
}

describe('web app e link verso l\'app', () => {
  it('serve la web app con navigazione lato client e CSP per le pagine', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aste-dist-'));
    mkdirSync(path.join(dir, '_expo/static/js'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(dir, '_expo/static/js/entry-abc.js'), 'console.log(1)');
    const app = await appWith({ WEB_DIR: dir });

    expect((await app.inject({ method: 'HEAD', url: '/auction/123' })).statusCode).toBe(200);
    const page = await app.inject({ url: '/auction/123?x=1' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="root"');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).toContain("connect-src 'self' blob: wss://aste.example.com");

    const js = await app.inject({ url: '/_expo/static/js/entry-abc.js' });
    expect(js.headers['cache-control']).toContain('immutable');
    // Le API restano JSON con la loro CSP, e i file inesistenti non diventano index.html.
    expect((await app.inject({ url: '/v1/inesistente' })).json().error.code).toBe('not_found');
    expect((await app.inject({ url: '/manca.js' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/health' })).headers['content-security-policy']).toContain("default-src 'none'");
    // Niente uscita dalla cartella della web app.
    expect((await app.inject({ url: '/..%2F..%2Fetc%2Fpasswd' })).body).not.toContain('root:');
    await app.close();
  });

  it('file .well-known per universal link e app link', async () => {
    const off = await appWith({});
    expect((await off.inject({ url: '/.well-known/apple-app-site-association' })).statusCode).toBe(404);
    await off.close();

    const app = await appWith({ APPLE_TEAM_ID: 'ABCDE12345', ANDROID_CERT_SHA256: 'AA:BB:CC' });
    const aasa = await app.inject({ url: '/.well-known/apple-app-site-association' });
    expect(aasa.headers['content-type']).toContain('application/json');
    expect(aasa.json().applinks.details[0].appIDs).toEqual(['ABCDE12345.it.asteonline.app']);
    const links = (await app.inject({ url: '/.well-known/assetlinks.json' })).json();
    expect(links[0].target).toMatchObject({ package_name: 'it.asteonline.app', sha256_cert_fingerprints: ['AA:BB:CC'] });
    await app.close();
  });

  it('in produzione la configurazione rifiuta impostazioni insicure', () => {
    const base = {
      NODE_ENV: 'production', DATABASE_URL: TEST_DB_URL, REDIS_URL: 'redis://r', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh',
      SMTP_URL: 'smtp://s', PUBLIC_URL: 'https://aste.example.com', API_URL: 'https://aste.example.com',
    };
    expect(() => loadConfig(base)).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...base, ALLOW_LOCAL_STORAGE: '1' })).not.toThrow();
    expect(() => loadConfig({ ...base, ALLOW_LOCAL_STORAGE: '1', API_URL: 'http://aste.example.com' })).toThrow(/https/);
  });
});
