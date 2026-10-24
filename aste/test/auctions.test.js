import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { register, login } from '../src/auth.js';
import { createAuction, placeBid, getAuction, listAuctions, listBids, ANTI_SNIPING_MS } from '../src/auctions.js';
import { createServer } from '../src/server.js';

const T0 = Date.UTC(2026, 0, 1);

function setup() {
  const db = openDb();
  const seller = register(db, { username: 'venditore', password: 'password-1' }, T0);
  const anna = register(db, { username: 'anna', password: 'password-2' }, T0);
  const bruno = register(db, { username: 'bruno', password: 'password-3' }, T0);
  const auction = createAuction(db, seller.id,
    { title: 'Bicicletta vintage', startingPrice: 5000, minIncrement: 500, durationMinutes: 60 }, T0);
  return { db, seller, anna, bruno, auction };
}

const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

test('registrazione e login', () => {
  const db = openDb();
  register(db, { username: 'carla', password: 'segreta-123' });
  assert.equal(login(db, { username: 'CARLA', password: 'segreta-123' }).username, 'carla');
  rejects(() => login(db, { username: 'carla', password: 'sbagliata' }), 401);
  rejects(() => login(db, { username: 'nessuno', password: 'segreta-123' }), 401);
  rejects(() => register(db, { username: 'Carla', password: 'altra-password' }), 409);
  rejects(() => register(db, { username: 'x', password: 'segreta-123' }), 400);
  rejects(() => register(db, { username: 'dario', password: 'corta' }), 400);
});

test('la prima offerta parte dal prezzo base, le successive dal rilancio minimo', () => {
  const { db, anna, bruno, auction } = setup();
  rejects(() => placeBid(db, auction.id, anna.id, 4999, T0 + 1000), 400);
  let a = placeBid(db, auction.id, anna.id, 5000, T0 + 1000);
  assert.equal(a.currentPrice, 5000);
  assert.equal(a.minimumBid, 5500);
  assert.equal(a.leader, 'anna');
  rejects(() => placeBid(db, auction.id, bruno.id, 5400, T0 + 2000), 400);
  a = placeBid(db, auction.id, bruno.id, 6000, T0 + 2000);
  assert.equal(a.leader, 'bruno');
  assert.equal(a.bidCount, 2);
  assert.deepEqual(listBids(db, auction.id).map((b) => b.bidder), ['bruno', 'anna']);
});

test('regole sulle offerte', () => {
  const { db, seller, anna, bruno, auction } = setup();
  rejects(() => placeBid(db, auction.id, seller.id, 5000, T0), 403);
  placeBid(db, auction.id, anna.id, 5000, T0);
  rejects(() => placeBid(db, auction.id, anna.id, 6000, T0), 409);
  rejects(() => placeBid(db, 999, anna.id, 6000, T0), 404);
  rejects(() => placeBid(db, auction.id, bruno.id, 6000.5, T0), 400);
  rejects(() => placeBid(db, auction.id, bruno.id, '9000', T0), 400);
});

test("l'asta chiude alla scadenza e indica il vincitore", () => {
  const { db, anna, bruno, auction } = setup();
  placeBid(db, auction.id, anna.id, 5000, T0);
  rejects(() => placeBid(db, auction.id, bruno.id, 9000, auction.endsAt), 409);
  const closed = getAuction(db, auction.id, auction.endsAt);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.winner, 'anna');
  assert.equal(listAuctions(db, { status: 'open' }, auction.endsAt).length, 0);
  assert.equal(listAuctions(db, { status: 'closed' }, auction.endsAt).length, 1);
});

test("anti-sniping: un'offerta negli ultimi minuti prolunga l'asta", () => {
  const { db, anna, bruno, auction } = setup();
  const early = placeBid(db, auction.id, anna.id, 5000, T0 + 1000);
  assert.equal(early.endsAt, auction.endsAt);
  const late = auction.endsAt - 30_000;
  const extended = placeBid(db, auction.id, bruno.id, 5500, late);
  assert.equal(extended.endsAt, late + ANTI_SNIPING_MS);
});

test('validazione della creazione', () => {
  const { db, seller } = setup();
  const base = { title: 'Lampada', startingPrice: 1000, durationMinutes: 60 };
  rejects(() => createAuction(db, seller.id, { ...base, title: 'ab' }), 400);
  rejects(() => createAuction(db, seller.id, { ...base, startingPrice: 0 }), 400);
  rejects(() => createAuction(db, seller.id, { ...base, startingPrice: 10.5 }), 400);
  rejects(() => createAuction(db, seller.id, { ...base, durationMinutes: 0 }), 400);
  assert.equal(createAuction(db, seller.id, base).minIncrement, 100);
});

test('API HTTP: registrazione, creazione asta, offerta', async (t) => {
  const server = createServer(openDb());
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, { cookie, body, method = body ? 'POST' : 'GET' } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const cookieOut = res.headers.get('set-cookie')?.split(';')[0];
    return { status: res.status, cookie: cookieOut, data: res.status === 204 ? null : await res.json() };
  };

  const v = await call('/api/register', { body: { username: 'venditore', password: 'password-1' } });
  assert.equal(v.status, 201);
  const b = await call('/api/register', { body: { username: 'compratore', password: 'password-2' } });

  assert.equal((await call('/api/auctions', { body: { title: 'Senza login', startingPrice: 100, durationMinutes: 5 } })).status, 401);
  const created = await call('/api/auctions', { cookie: v.cookie, body: { title: 'Orologio', startingPrice: 2000, durationMinutes: 5 } });
  assert.equal(created.status, 201);
  const id = created.data.auction.id;

  const bid = await call(`/api/auctions/${id}/bids`, { cookie: b.cookie, body: { amount: 2000 } });
  assert.equal(bid.status, 201);
  assert.equal(bid.data.auction.leader, 'compratore');

  const detail = await call(`/api/auctions/${id}`);
  assert.equal(detail.data.bids.length, 1);
  assert.equal((await call('/api/me', { cookie: b.cookie })).data.user.username, 'compratore');

  // Un form cross-site non può inviare JSON: le richieste senza Content-Type JSON sono rifiutate.
  const form = await fetch(`${base}/api/auctions/${id}/bids`, {
    method: 'POST', headers: { Cookie: b.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'amount=9999',
  });
  assert.equal(form.status, 415);

  assert.equal((await call('/api/logout', { cookie: b.cookie, body: {} })).status, 204);
  assert.equal((await call('/api/me', { cookie: b.cookie })).data.user, null);
});
