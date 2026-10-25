import { describe, expect, it } from 'vitest';
import { closeEndedAuctions } from '../src/jobs.js';
import { api, bid, createActiveAuction, createUser, makeSeller, relogin, useTestApp } from './helpers.js';

const ctx = useTestApp();

describe('profilo, privacy e moderazione', () => {
  it('profilo venditore professionale: dati DSA obbligatori e pubblici', async () => {
    const u = await createUser(ctx, { name: 'negozio' });
    const base = { type: 'business', legalName: 'Negozio Srl', addressLine: 'Corso Italia 10', city: 'Roma', postalCode: '00100', country: 'IT' };
    expect((await api(ctx, 'PUT', '/me/seller', { token: u.token, body: base })).status).toBe(400);
    const ok = await api(ctx, 'PUT', '/me/seller', { token: u.token, body: { ...base, vatNumber: 'it12345678901', phone: '+39 06 1234567', businessEmail: 'info@negozio.it' } });
    expect(ok.status).toBe(200);
    const pub = (await api(ctx, 'GET', `/users/${u.id}`)).body.user;
    expect(pub.sellerType).toBe('business');
    expect(pub.business).toMatchObject({ legalName: 'Negozio Srl', vatNumber: 'IT12345678901', email: 'info@negozio.it' });
    // Dei privati non si pubblica nulla oltre al nome utente.
    const priv = await createUser(ctx, { name: 'privato' });
    await makeSeller(ctx, priv);
    const p = (await api(ctx, 'GET', `/users/${priv.id}`)).body.user;
    expect(p.sellerType).toBe('private');
    expect(p.business).toBeNull();
    expect(JSON.stringify(p)).not.toContain('Via Roma');
  });

  it('esportazione dei dati personali', async () => {
    const u = await createUser(ctx);
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/export', headers: { authorization: `Bearer ${u.token}` } });
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.account.email).toBe(u.email);
    expect(JSON.stringify(data)).not.toContain('argon2');
  });

  it('cancellazione account: bloccata con attività aperte, poi anonimizza e chiude le sessioni', async () => {
    const seller = await createUser(ctx, { name: 'venditore' });
    await makeSeller(ctx, seller);
    const anna = await createUser(ctx, { name: 'anna' });
    const auction = await createActiveAuction(ctx, seller);
    await bid(ctx, anna, auction.id, 20_000);
    expect((await api(ctx, 'DELETE', '/me', { token: anna.token, body: { password: 'sbagliata' } })).status).toBe(400);
    expect((await api(ctx, 'DELETE', '/me', { token: anna.token, body: { password: anna.password } })).body.error.code).toBe('account_has_open_activity');

    const carlo = await createUser(ctx, { name: 'carlo' });
    await api(ctx, 'PUT', `/auctions/${auction.id}/watch`, { token: carlo.token });
    expect((await api(ctx, 'DELETE', '/me', { token: carlo.token, body: { password: carlo.password } })).status).toBe(204);
    expect((await api(ctx, 'GET', '/me', { token: carlo.token })).status).toBe(401);
    expect((await api(ctx, 'POST', '/auth/login', { body: { email: carlo.email, password: carlo.password } })).status).toBe(401);
    const row = (await ctx.db.query('SELECT email, display_name, password_hash, status FROM users WHERE id = $1', [carlo.id])).rows[0];
    expect(row).toMatchObject({ status: 'deleted', password_hash: null });
    expect(row.email).not.toContain('carlo');
    // L'email si può riusare per un nuovo account.
    expect((await api(ctx, 'POST', '/auth/register', { body: { email: carlo.email, password: 'una-password-sicura-123', displayName: 'carlo2', acceptTerms: true, confirmAdult: true } })).status).toBe(202);
    expect(ctx.mailer.lastTo(carlo.email)!.subject).toContain('Conferma');

    // Dopo la chiusura e la conclusione dell'ordine, anche Anna può eliminare l'account.
    ctx.clock.advance(8 * 86_400_000);
    await closeEndedAuctions(ctx.app);
    await ctx.db.query("UPDATE orders SET status = 'completed'");
    await relogin(ctx, anna);
    expect((await api(ctx, 'DELETE', '/me', { token: anna.token, body: { password: anna.password } })).status).toBe(204);
  });

  it('segnalazione e rimozione di un annuncio con motivazione al venditore', async () => {
    const seller = await createUser(ctx, { name: 'venditore' });
    await makeSeller(ctx, seller);
    const anna = await createUser(ctx, { name: 'anna' });
    const admin = await createUser(ctx, { name: 'moderatore', admin: true });
    const auction = await createActiveAuction(ctx, seller);
    expect((await api(ctx, 'POST', '/reports', { token: anna.token, body: { targetType: 'auction', targetId: auction.id, reason: 'counterfeit', details: 'Marchio falso' } })).status).toBe(202);
    expect((await api(ctx, 'GET', '/admin/reports', { token: anna.token })).status).toBe(403);
    const reports = (await api(ctx, 'GET', '/admin/reports', { token: admin.token })).body.reports;
    expect(reports).toHaveLength(1);
    const res = await api(ctx, 'POST', `/admin/reports/${reports[0].id}/resolve`, { token: admin.token, body: { action: 'remove_auction', statement: 'Prodotto contraffatto, vietato dalle regole' } });
    expect(res.status).toBe(200);
    expect((await api(ctx, 'GET', `/auctions/${auction.id}`)).status).toBe(404);
    expect(ctx.mailer.lastTo(seller.email)!.text).toContain('Prodotto contraffatto');
  });

  it('sospensione di un utente: sessioni chiuse e aste rimosse', async () => {
    const seller = await createUser(ctx, { name: 'truffatore' });
    await makeSeller(ctx, seller);
    const anna = await createUser(ctx, { name: 'anna' });
    const admin = await createUser(ctx, { name: 'moderatore', admin: true });
    const auction = await createActiveAuction(ctx, seller);
    await api(ctx, 'POST', '/reports', { token: anna.token, body: { targetType: 'user', targetId: seller.id, reason: 'fraud' } });
    const [report] = (await api(ctx, 'GET', '/admin/reports', { token: admin.token })).body.reports;
    await api(ctx, 'POST', `/admin/reports/${report.id}/resolve`, { token: admin.token, body: { action: 'suspend_user', statement: 'Truffe ripetute segnalate' } });
    expect((await api(ctx, 'GET', '/me', { token: seller.token })).status).toBe(401);
    expect((await api(ctx, 'POST', '/auth/login', { body: { email: seller.email, password: seller.password } })).body.error.code).toBe('account_suspended');
    expect((await api(ctx, 'GET', `/auctions/${auction.id}`)).status).toBe(404);
  });
});
