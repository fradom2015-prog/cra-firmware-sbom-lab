import { describe, expect, it } from 'vitest';
import { autoReleasePayouts, cancelUnpaidOrders, closeEndedAuctions } from '../src/jobs.js';
import { api, bid, createActiveAuction, createUser, makeSeller, relogin, useTestApp, type TestCtx } from './helpers.js';

const ctx = useTestApp();
const address = { name: 'Anna Bianchi', line1: 'Via Verdi 3', city: 'Torino', postalCode: '10100', country: 'it', phone: '+39 333 1234567' };

function webhook(c: TestCtx, event: object, signature = 'fake-signature') {
  return c.app.inject({
    method: 'POST', url: '/v1/webhooks/payments', payload: JSON.stringify(event),
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
  });
}

// Asta venduta ad Anna per 200 € + 10 € di spedizione.
async function soldOrder() {
  const seller = await createUser(ctx, { name: 'venditore' });
  await makeSeller(ctx, seller);
  const anna = await createUser(ctx, { name: 'anna' });
  const auction = await createActiveAuction(ctx, seller, { startingPrice: 20_000 });
  await bid(ctx, anna, auction.id, 20_000);
  ctx.clock.advance(7 * 86_400_000);
  await closeEndedAuctions(ctx.app);
  await relogin(ctx, seller);
  await relogin(ctx, anna);
  const order = (await api(ctx, 'GET', '/orders', { token: anna.token })).body.orders[0];
  return { seller, anna, order };
}

async function paidOrder() {
  const r = await soldOrder();
  const pay = await api(ctx, 'POST', `/orders/${r.order.id}/pay`, { token: r.anna.token, body: { shippingAddress: address } });
  const pi = pay.body.clientSecret.replace('_secret', '');
  await webhook(ctx, { id: 'evt_1', kind: 'payment_succeeded', paymentIntentId: pi, amount: pay.body.amount, orderId: r.order.id });
  return { ...r, pi };
}

describe('pagamento protetto', () => {
  it('flusso completo: paga, spedisce, conferma, il venditore riceve il netto', async () => {
    const { seller, anna, order } = await soldOrder();
    expect(order).toMatchObject({ itemAmount: 20_000, shippingAmount: 1_000, buyerFee: 1_000, totalAmount: 22_000, status: 'awaiting_payment' });

    // Il venditore non vede l'indirizzo prima del pagamento.
    const pay = await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: anna.token, body: { shippingAddress: address } });
    expect(pay.body.amount).toBe(22_000);
    expect((await api(ctx, 'GET', `/orders/${order.id}`, { token: seller.token })).body.order.shippingAddress).toBeNull();
    // Un secondo tentativo riusa lo stesso pagamento: mai due addebiti.
    const again = await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: anna.token, body: { shippingAddress: address } });
    expect(again.body.clientSecret).toBe(pay.body.clientSecret);
    expect(ctx.payments.payments.size).toBe(1);

    expect((await api(ctx, 'POST', `/orders/${order.id}/ship`, { token: seller.token, body: { carrier: 'BRT', trackingNumber: '123456789' } })).status).toBe(409);

    const pi = pay.body.clientSecret.replace('_secret', '');
    expect((await webhook(ctx, { id: 'evt_1', kind: 'payment_succeeded', paymentIntentId: pi, amount: 22_000, orderId: order.id })).statusCode).toBe(200);
    const sellerView = (await api(ctx, 'GET', `/orders/${order.id}`, { token: seller.token })).body.order;
    expect(sellerView).toMatchObject({ status: 'paid', sellerFee: 2_000, payout: 19_000 });
    expect(sellerView.shippingAddress.city).toBe('Torino');
    expect(sellerView.buyerFee).toBeUndefined();

    expect((await api(ctx, 'POST', `/orders/${order.id}/confirm-delivery`, { token: anna.token })).status).toBe(409);
    await api(ctx, 'POST', `/orders/${order.id}/ship`, { token: seller.token, body: { carrier: 'BRT', trackingNumber: '123456789' } });
    expect(ctx.payments.transfers).toHaveLength(0);
    const done = await api(ctx, 'POST', `/orders/${order.id}/confirm-delivery`, { token: anna.token });
    expect(done.body.order.status).toBe('completed');
    expect(ctx.payments.transfers).toEqual([expect.objectContaining({ orderId: order.id, amount: 19_000 })]);

    expect((await api(ctx, 'POST', `/orders/${order.id}/review`, { token: anna.token, body: { rating: 5, comment: 'Perfetto' } })).status).toBe(201);
    expect((await api(ctx, 'POST', `/orders/${order.id}/review`, { token: anna.token, body: { rating: 1 } })).status).toBe(409);
    expect((await api(ctx, 'GET', `/users/${seller.id}`)).body.user.rating).toEqual({ average: 5, count: 1 });
  });

  it('webhook: firma obbligatoria, eventi duplicati ignorati, importo verificato', async () => {
    const { anna, order } = await soldOrder();
    const pay = await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: anna.token, body: { shippingAddress: address } });
    const pi = pay.body.clientSecret.replace('_secret', '');
    expect((await webhook(ctx, { id: 'evt_x', kind: 'payment_succeeded', paymentIntentId: pi, amount: 22_000 }, 'firma-falsa')).statusCode).toBe(400);
    await webhook(ctx, { id: 'evt_low', kind: 'payment_succeeded', paymentIntentId: pi, amount: 100 });
    expect((await api(ctx, 'GET', `/orders/${order.id}`, { token: anna.token })).body.order.status).toBe('awaiting_payment');
    await webhook(ctx, { id: 'evt_ok', kind: 'payment_succeeded', paymentIntentId: pi, amount: 22_000 });
    await webhook(ctx, { id: 'evt_ok', kind: 'payment_succeeded', paymentIntentId: pi, amount: 22_000 });
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM payment_events WHERE id = 'evt_ok'")).rows[0].n).toBe(1);
    expect((await api(ctx, 'GET', `/orders/${order.id}`, { token: anna.token })).body.order.status).toBe('paid');
  });

  it('solo il compratore paga, solo il venditore spedisce', async () => {
    const { seller, anna, order } = await soldOrder();
    const intruder = await createUser(ctx, { name: 'intruso' });
    expect((await api(ctx, 'GET', `/orders/${order.id}`, { token: intruder.token })).status).toBe(404);
    expect((await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: seller.token, body: { shippingAddress: address } })).status).toBe(404);
    expect((await api(ctx, 'POST', `/orders/${order.id}/ship`, { token: anna.token, body: { carrier: 'BRT', trackingNumber: '1234' } })).status).toBe(409);
  });

  it('contestazione: fondi bloccati, l\'amministratore rimborsa', async () => {
    const { anna, order } = await paidOrder();
    const admin = await createUser(ctx, { name: 'admin', admin: true });
    expect((await api(ctx, 'POST', `/orders/${order.id}/dispute`, { token: anna.token, body: { reason: 'Non è mai arrivato nulla' } })).body.order.status).toBe('disputed');
    ctx.clock.advance(30 * 86_400_000);
    expect(await autoReleasePayouts(ctx.app)).toBe(0);
    await relogin(ctx, admin);
    await relogin(ctx, anna);
    expect((await api(ctx, 'POST', `/admin/orders/${order.id}/resolve`, { token: anna.token, body: { action: 'refund' } })).status).toBe(403);
    expect((await api(ctx, 'POST', `/admin/orders/${order.id}/resolve`, { token: admin.token, body: { action: 'refund' } })).status).toBe(200);
    expect(ctx.payments.refunds).toEqual([order.id]);
    expect(ctx.payments.transfers).toHaveLength(0);
  });

  it('rilascio automatico dopo 14 giorni dalla spedizione senza contestazioni', async () => {
    const { seller, order } = await paidOrder();
    await api(ctx, 'POST', `/orders/${order.id}/ship`, { token: seller.token, body: { carrier: 'Poste', trackingNumber: 'AB123456' } });
    ctx.clock.advance(13 * 86_400_000);
    expect(await autoReleasePayouts(ctx.app)).toBe(0);
    ctx.clock.advance(2 * 86_400_000);
    expect(await autoReleasePayouts(ctx.app)).toBe(1);
    expect(ctx.payments.transfers[0]!.amount).toBe(19_000);
  });

  it('mancato pagamento: ordine annullato; un pagamento tardivo viene rimborsato', async () => {
    const { anna, order } = await soldOrder();
    const pay = await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: anna.token, body: { shippingAddress: address } });
    ctx.clock.advance(4 * 86_400_000);
    expect(await cancelUnpaidOrders(ctx.app)).toBe(1);
    await relogin(ctx, anna);
    expect((await api(ctx, 'POST', `/orders/${order.id}/pay`, { token: anna.token, body: { shippingAddress: address } })).status).toBe(409);
    await webhook(ctx, { id: 'evt_late', kind: 'payment_succeeded', paymentIntentId: pay.body.clientSecret.replace('_secret', ''), amount: 22_000 });
    expect(ctx.payments.refunds).toEqual([order.id]);
  });

  it('chargeback bancario: l\'ordine passa in contestazione', async () => {
    const { anna, order, pi } = await paidOrder();
    await webhook(ctx, { id: 'evt_dispute', kind: 'dispute_created', paymentIntentId: pi });
    expect((await api(ctx, 'GET', `/orders/${order.id}`, { token: anna.token })).body.order.status).toBe('disputed');
  });
});
