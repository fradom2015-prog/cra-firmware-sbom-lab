import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { closeEndedAuctions } from '../src/jobs.js';
import { api, bid, createActiveAuction, createUser, makeSeller, relogin, testImage, uploadImage, useTestApp } from './helpers.js';

const ctx = useTestApp();

async function setup() {
  const seller = await createUser(ctx, { name: 'venditore' });
  await makeSeller(ctx, seller);
  const anna = await createUser(ctx, { name: 'anna' });
  const bruno = await createUser(ctx, { name: 'bruno' });
  return { seller, anna, bruno };
}

describe('aste', () => {
  it('pubblicazione: servono profilo venditore, pagamenti attivi e almeno una foto', async () => {
    const u = await createUser(ctx);
    const draft = await api(ctx, 'POST', '/auctions', { token: u.token, body: {
      categorySlug: 'arte', title: 'Quadro ad olio', description: 'Firmato', condition: 'good', startingPrice: 5_000,
    } });
    expect(draft.status).toBe(201);
    const id = draft.body.auction.id;
    expect((await api(ctx, 'POST', `/auctions/${id}/publish`, { token: u.token })).body.error.code).toBe('seller_profile_required');
    await makeSeller(ctx, u);
    expect((await api(ctx, 'POST', `/auctions/${id}/publish`, { token: u.token })).body.error.code).toBe('images_required');
    await uploadImage(ctx, u.token, id, await testImage());
    const pub = await api(ctx, 'POST', `/auctions/${id}/publish`, { token: u.token });
    expect(pub.status).toBe(200);
    expect(pub.body.auction.status).toBe('active');
    expect(new Date(pub.body.auction.endsAt).getTime() - ctx.clock.now.getTime()).toBe(7 * 86_400_000);
    // Pubblicata non si modifica più.
    expect((await api(ctx, 'PATCH', `/auctions/${id}`, { token: u.token, body: { title: 'Titolo cambiato' } })).status).toBe(409);
  });

  it('serve un\'email verificata per vendere e offrire', async () => {
    const { seller } = await setup();
    const auction = await createActiveAuction(ctx, seller);
    const unverified = await createUser(ctx, { verified: false });
    expect((await bid(ctx, unverified, auction.id, 10_000)).body.error.code).toBe('email_not_verified');
    expect((await api(ctx, 'POST', '/auctions', { token: unverified.token, body: {} })).status).toBe(403);
  });

  it('immagini: ricodificate in WebP senza metadati (niente GPS)', async () => {
    const { seller } = await setup();
    const draft = await api(ctx, 'POST', '/auctions', { token: seller.token, body: {
      categorySlug: 'arte', title: 'Statuetta in bronzo', description: '', condition: 'good', startingPrice: 5_000,
    } });
    const original = await testImage({ gps: true });
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const up = await uploadImage(ctx, seller.token, draft.body.auction.id, original);
    expect(up.status).toBe(201);
    const key = up.body.image.url.split('/media/')[1];
    const stored = await ctx.app.inject({ method: 'GET', url: `/media/${key}` });
    const meta = await sharp(stored.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    // File che non sono immagini: rifiutati.
    const fake = await uploadImage(ctx, seller.token, draft.body.auction.id, Buffer.from('<?php system($_GET[1]); ?>'), 'x.jpg');
    expect(fake.status).toBe(400);
    // Accesso a percorsi arbitrari impossibile.
    expect((await ctx.app.inject({ method: 'GET', url: '/media/..%2F..%2Fetc/passwd' })).statusCode).toBe(404);
  });

  it('solo il venditore può modificare la propria bozza', async () => {
    const { seller, anna } = await setup();
    const draft = await api(ctx, 'POST', '/auctions', { token: seller.token, body: {
      categorySlug: 'arte', title: 'Statuetta in bronzo', description: '', condition: 'good', startingPrice: 5_000,
    } });
    const id = draft.body.auction.id;
    expect((await api(ctx, 'PATCH', `/auctions/${id}`, { token: anna.token, body: { title: 'Rubata!!' } })).status).toBe(404);
    expect((await api(ctx, 'GET', `/auctions/${id}`, { token: anna.token })).status).toBe(404);
    expect((await uploadImage(ctx, anna.token, id, await testImage())).status).toBe(404);
  });

  it('offerte automatiche via API, senza rivelare il massimo né la riserva', async () => {
    const { seller, anna, bruno } = await setup();
    const auction = await createActiveAuction(ctx, seller, { reservePrice: 30_000 });
    const a1 = await bid(ctx, anna, auction.id, 25_000);
    expect(a1.status).toBe(201);
    expect(a1.body.auction).toMatchObject({ currentPrice: 10_000, hasReserve: true, reserveMet: false });
    expect(a1.body.auction.viewer).toMatchObject({ isLeader: true, maxBid: 25_000 });

    const b1 = await bid(ctx, bruno, auction.id, 20_000);
    expect(b1.body.outbid).toBe(true);
    expect(b1.body.auction.currentPrice).toBe(21_000);
    // Chi viene superato subito lo vede nella risposta: nessuna email.
    expect(ctx.mailer.lastTo(bruno.email)!.subject).not.toContain('superato');

    const b2 = await bid(ctx, bruno, auction.id, 40_000);
    expect(b2.body.auction).toMatchObject({ currentPrice: 30_000, reserveMet: true });
    expect(ctx.mailer.lastTo(anna.email)!.subject).toContain('superato');

    const pub = await api(ctx, 'GET', `/auctions/${auction.id}`);
    const json = JSON.stringify(pub.body);
    expect(json).not.toContain('40000');
    expect(json).not.toContain('reservePrice');
    expect(pub.body.auction.leader).toBe('b***o');

    const history = await api(ctx, 'GET', `/auctions/${auction.id}/bids`, { token: anna.token });
    expect(history.body.bids.map((b: { amount: number }) => b.amount)).toEqual([30_000, 25_000, 21_000, 20_000, 10_000]);
  });

  it('regole: niente offerte sulla propria asta, se bloccati o ad asta chiusa', async () => {
    const { seller, anna } = await setup();
    const auction = await createActiveAuction(ctx, seller);
    expect((await bid(ctx, seller, auction.id, 20_000)).body.error.code).toBe('own_auction');
    await api(ctx, 'PUT', `/blocks/${anna.id}`, { token: seller.token });
    expect((await bid(ctx, anna, auction.id, 20_000)).body.error.code).toBe('blocked');
    await api(ctx, 'DELETE', `/blocks/${anna.id}`, { token: seller.token });
    expect((await bid(ctx, anna, auction.id, 9_000)).body.error.code).toBe('below_minimum');
    expect((await bid(ctx, anna, auction.id, 20_000)).status).toBe(201);
    ctx.clock.advance(8 * 86_400_000);
    await relogin(ctx, anna);
    expect((await bid(ctx, anna, auction.id, 90_000)).body.error.code).toBe('auction_closed');
  });

  it('idempotenza: la stessa offerta ripetuta non viene registrata due volte', async () => {
    const { seller, anna } = await setup();
    const auction = await createActiveAuction(ctx, seller);
    expect((await bid(ctx, anna, auction.id, 20_000, 'tocco-unico-123')).status).toBe(201);
    const again = await bid(ctx, anna, auction.id, 20_000, 'tocco-unico-123');
    expect(again.status).toBe(200);
    expect(again.body.auction.bidCount).toBe(1);
  });

  it('offerte concorrenti: il database resta coerente', async () => {
    const { seller } = await setup();
    const auction = await createActiveAuction(ctx, seller);
    const users = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => createUser(ctx, { name: `conc${i}` })));
    await Promise.all(users.map((u, i) => bid(ctx, u, auction.id, 20_000 + i * 3_000)));
    const a = (await ctx.db.query('SELECT current_price, leader_max, leader_id FROM auctions WHERE id = $1', [auction.id])).rows[0];
    expect(a.leader_max).toBe(35_000);
    expect(a.leader_id).toBe(users[5]!.id);
    expect(a.current_price).toBe(33_000);
  });

  it('anti-sniping: un\'offerta negli ultimi 2 minuti prolunga l\'asta', async () => {
    const { seller, anna } = await setup();
    const auction = await createActiveAuction(ctx, seller);
    const end = new Date(auction.endsAt).getTime();
    ctx.clock.now = new Date(end - 30_000);
    await relogin(ctx, anna);
    const res = await bid(ctx, anna, auction.id, 20_000);
    expect(new Date(res.body.auction.endsAt).getTime()).toBe(end - 30_000 + 120_000);
  });

  it('il venditore può ritirare l\'asta solo senza offerte', async () => {
    const { seller, anna } = await setup();
    const a1 = await createActiveAuction(ctx, seller);
    expect((await api(ctx, 'POST', `/auctions/${a1.id}/cancel`, { token: seller.token })).body.auction.status).toBe('cancelled');
    const a2 = await createActiveAuction(ctx, seller);
    await bid(ctx, anna, a2.id, 20_000);
    expect((await api(ctx, 'POST', `/auctions/${a2.id}/cancel`, { token: seller.token })).body.error.code).toBe('has_bids');
  });

  it('chiusura: crea l\'ordine con le commissioni e avvisa vincitore e venditore', async () => {
    const { seller, anna, bruno } = await setup();
    const sold = await createActiveAuction(ctx, seller);
    const unsold = await createActiveAuction(ctx, seller, { reservePrice: 100_000 });
    await bid(ctx, anna, sold.id, 30_000);
    await bid(ctx, bruno, sold.id, 25_000);
    await bid(ctx, bruno, unsold.id, 50_000);
    ctx.clock.advance(7 * 86_400_000);
    expect(await closeEndedAuctions(ctx.app)).toBe(2);
    expect(await closeEndedAuctions(ctx.app)).toBe(0);

    const orders = (await ctx.db.query('SELECT * FROM orders')).rows;
    expect(orders).toHaveLength(1);
    // 26.000 di prezzo, 1.000 di spedizione, 5% acquirente, 10% venditore
    expect(orders[0]).toMatchObject({ buyer_id: anna.id, item_amount: 26_000, shipping_amount: 1_000, buyer_fee: 1_300, seller_fee: 2_600, total_amount: 28_300, status: 'awaiting_payment' });
    expect(ctx.mailer.lastTo(anna.email)!.subject).toContain('Hai vinto');
    expect((await api(ctx, 'GET', `/auctions/${unsold.id}`)).body.auction.status).toBe('ended_unsold');
  });

  it('ricerca testuale, categorie e ordinamenti', async () => {
    const { seller } = await setup();
    await createActiveAuction(ctx, seller, { title: 'Macchina fotografica Leica M6', categorySlug: 'elettronica', startingPrice: 90_000 });
    await createActiveAuction(ctx, seller, { title: 'Orologio Omega Seamaster', categorySlug: 'orologi-gioielli', startingPrice: 150_000 });
    await createActiveAuction(ctx, seller, { title: 'Fotocamera Nikon F3', categorySlug: 'elettronica', startingPrice: 30_000 });
    const q = await api(ctx, 'GET', '/auctions?q=fotografica');
    expect(q.body.items.map((a: { title: string }) => a.title)).toEqual(['Macchina fotografica Leica M6']);
    const cat = await api(ctx, 'GET', '/auctions?category=elettronica&sort=price_asc');
    expect(cat.body.items.map((a: { startingPrice: number }) => a.startingPrice)).toEqual([30_000, 90_000]);
    expect(cat.body.total).toBe(2);
    expect((await api(ctx, 'GET', '/auctions?sort=sql-injection')).status).toBe(400);
  });

  it('preferiti e liste personali', async () => {
    const { seller, anna } = await setup();
    const a = await createActiveAuction(ctx, seller);
    await api(ctx, 'PUT', `/auctions/${a.id}/watch`, { token: anna.token });
    expect((await api(ctx, 'GET', `/auctions/${a.id}`, { token: anna.token })).body.watching).toBe(true);
    expect((await api(ctx, 'GET', '/me/watchlist', { token: anna.token })).body.total).toBe(1);
    await bid(ctx, anna, a.id, 20_000);
    expect((await api(ctx, 'GET', '/me/bidding', { token: anna.token })).body.items[0].viewer.isLeader).toBe(true);
    expect((await api(ctx, 'GET', '/me/auctions', { token: seller.token })).body.total).toBe(1);
  });
});
