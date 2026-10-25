import { describe, expect, it } from 'vitest';
import { api, createUser, tokenFrom, useTestApp } from './helpers.js';

const ctx = useTestApp();
const body = (over = {}) => ({ email: 'anna@example.com', password: 'una-password-sicura-123', displayName: 'anna', acceptTerms: true, confirmAdult: true, ...over });

describe('account', () => {
  it('registrazione: stessa risposta se l\'email esiste già (niente enumerazione)', async () => {
    expect((await api(ctx, 'POST', '/auth/register', { body: body() })).status).toBe(202);
    const again = await api(ctx, 'POST', '/auth/register', { body: body({ displayName: 'altra' }) });
    expect(again.status).toBe(202);
    expect(ctx.mailer.lastTo('anna@example.com')!.subject).toBe('Hai già un account');
    const { n } = (await ctx.db.query('SELECT count(*)::int AS n FROM users')).rows[0];
    expect(n).toBe(1);
  });

  it('registrazione: validazioni', async () => {
    const cases = [
      body({ password: 'corta' }),
      body({ acceptTerms: false }),
      body({ confirmAdult: false }),
      body({ email: 'non-una-email' }),
      body({ displayName: 'a b' }),
      body({ password: 'anna-password-123' }), // contiene la parte locale dell'email
    ];
    for (const b of cases) expect((await api(ctx, 'POST', '/auth/register', { body: b })).status).toBe(400);
    await api(ctx, 'POST', '/auth/register', { body: body() });
    expect((await api(ctx, 'POST', '/auth/register', { body: body({ email: 'b@example.com', displayName: 'ANNA' }) })).status).toBe(409);
  });

  it('verifica email monouso e con scadenza', async () => {
    await api(ctx, 'POST', '/auth/register', { body: body() });
    const token = tokenFrom(ctx.mailer.lastTo('anna@example.com')!.text);
    expect((await api(ctx, 'POST', '/auth/verify-email', { body: { token } })).status).toBe(200);
    expect((await api(ctx, 'POST', '/auth/verify-email', { body: { token } })).status).toBe(400);

    await api(ctx, 'POST', '/auth/register', { body: body({ email: 'b@example.com', displayName: 'bea' }) });
    const late = tokenFrom(ctx.mailer.lastTo('b@example.com')!.text);
    ctx.clock.advance(25 * 3600_000);
    expect((await api(ctx, 'POST', '/auth/verify-email', { body: { token: late } })).status).toBe(400);
  });

  it('login: errori generici e blocco dopo 10 tentativi', async () => {
    const u = await createUser(ctx);
    const wrong = await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: 'sbagliata-davvero' } });
    const unknown = await api(ctx, 'POST', '/auth/login', { body: { email: 'nessuno@example.com', password: 'sbagliata-davvero' } });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);

    await ctx.db.query('UPDATE users SET failed_logins = 9 WHERE id = $1', [u.id]);
    await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: 'sbagliata-davvero' } });
    const locked = await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: u.password } });
    expect(locked.status).toBe(429);
    ctx.clock.advance(16 * 60_000);
    expect((await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: u.password } })).status).toBe(200);
  });

  it('access token scade dopo 15 minuti; il refresh ruota', async () => {
    const u = await createUser(ctx);
    ctx.clock.advance(16 * 60_000);
    expect((await api(ctx, 'GET', '/me', { token: u.token })).status).toBe(401);
    const r = await api(ctx, 'POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).not.toBe(u.refreshToken);
    expect((await api(ctx, 'GET', '/me', { token: r.body.accessToken })).status).toBe(200);
  });

  it('riuso di un refresh token già usato: revoca tutta la famiglia di sessioni', async () => {
    const u = await createUser(ctx);
    const r1 = await api(ctx, 'POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    // Un attaccante riusa il vecchio token rubato.
    expect((await api(ctx, 'POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } })).status).toBe(401);
    // Anche la sessione legittima viene chiusa.
    expect((await api(ctx, 'GET', '/me', { token: r1.body.accessToken })).status).toBe(401);
    expect((await api(ctx, 'POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401);
  });

  it('logout revoca la sessione', async () => {
    const u = await createUser(ctx);
    expect((await api(ctx, 'POST', '/auth/logout', { token: u.token })).status).toBe(204);
    expect((await api(ctx, 'GET', '/me', { token: u.token })).status).toBe(401);
  });

  it('reset password: link monouso, chiude tutte le sessioni', async () => {
    const u = await createUser(ctx);
    expect((await api(ctx, 'POST', '/auth/forgot-password', { body: { email: 'nessuno@example.com' } })).status).toBe(202);
    await api(ctx, 'POST', '/auth/forgot-password', { body: { email: u.email } });
    const token = tokenFrom(ctx.mailer.lastTo(u.email)!.text);
    const res = await api(ctx, 'POST', '/auth/reset-password', { body: { token, password: 'nuova-password-sicura-9' } });
    expect(res.status).toBe(200);
    expect((await api(ctx, 'GET', '/me', { token: u.token })).status).toBe(401);
    expect((await api(ctx, 'POST', '/auth/reset-password', { body: { token, password: 'altra-password-sicura-9' } })).status).toBe(400);
    expect((await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: 'nuova-password-sicura-9' } })).status).toBe(200);
  });

  it('cambio password: richiede quella attuale e chiude le altre sessioni', async () => {
    const u = await createUser(ctx);
    const other = await api(ctx, 'POST', '/auth/login', { body: { email: u.email, password: u.password } });
    expect((await api(ctx, 'POST', '/auth/change-password', { token: u.token, body: { currentPassword: 'sbagliata', newPassword: 'nuova-password-sicura-9' } })).status).toBe(400);
    expect((await api(ctx, 'POST', '/auth/change-password', { token: u.token, body: { currentPassword: u.password, newPassword: 'nuova-password-sicura-9' } })).status).toBe(200);
    expect((await api(ctx, 'GET', '/me', { token: u.token })).status).toBe(200);
    expect((await api(ctx, 'GET', '/me', { token: other.body.accessToken })).status).toBe(401);
  });

  it('le password sono salvate con Argon2id', async () => {
    const u = await createUser(ctx);
    const { password_hash } = (await ctx.db.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0];
    expect(password_hash).toMatch(/^\$argon2id\$/);
  });

  it('gli header di sicurezza sono presenti', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('limite di frequenza sul login', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await api(ctx, 'POST', '/auth/login', { body: { email: 'x@example.com', password: 'qualsiasi-cosa' } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
