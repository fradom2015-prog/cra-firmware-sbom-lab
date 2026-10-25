import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db/pool.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { formatEuro } from '../lib/money.js';
import { audit, parse, requireAdmin, requireUser, requireVerified, uuidParam } from '../lib/http.js';
import { WebhookSignatureError, type PaymentEvent } from '../services/payments.js';
import { notifyUser } from '../services/notify.js';

interface OrderRow {
  id: string;
  auction_id: string;
  buyer_id: string;
  seller_id: string;
  item_amount: number;
  shipping_amount: number;
  buyer_fee: number;
  seller_fee: number;
  total_amount: number;
  status: string;
  payment_intent_id: string | null;
  shipping_address: Record<string, string> | null;
  payment_due_at: Date;
  paid_at: Date | null;
  shipped_at: Date | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  dispute_reason: string | null;
  completed_at: Date | null;
  created_at: Date;
  title: string;
  buyer_name: string;
  seller_name: string;
}

const ORDER_SELECT = `
  SELECT o.*, a.title, b.display_name AS buyer_name, s.display_name AS seller_name
  FROM orders o JOIN auctions a ON a.id = o.auction_id
  JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id`;

const addressSchema = z.object({
  name: z.string().trim().min(3).max(120),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(12),
  province: z.string().trim().max(50).optional(),
  country: z.string().trim().length(2).toUpperCase(),
  phone: z.string().trim().regex(/^\+?[0-9 ]{6,20}$/, 'Numero di telefono non valido'),
});

function view(o: OrderRow, viewerId: string) {
  const isSeller = viewerId === o.seller_id;
  return {
    id: o.id,
    auctionId: o.auction_id,
    title: o.title,
    role: isSeller ? 'seller' : 'buyer',
    buyer: o.buyer_name,
    seller: o.seller_name,
    status: o.status,
    itemAmount: o.item_amount,
    shippingAmount: o.shipping_amount,
    // Ognuno vede la propria commissione e il proprio totale.
    ...(isSeller
      ? { sellerFee: o.seller_fee, payout: o.item_amount + o.shipping_amount - o.seller_fee }
      : { buyerFee: o.buyer_fee, totalAmount: o.total_amount }),
    // L'indirizzo arriva al venditore solo a pagamento avvenuto.
    shippingAddress: !isSeller || o.paid_at ? o.shipping_address : null,
    paymentDueAt: o.payment_due_at,
    paidAt: o.paid_at,
    shippedAt: o.shipped_at,
    tracking: o.tracking_number ? { carrier: o.tracking_carrier, number: o.tracking_number } : null,
    disputeReason: o.dispute_reason,
    completedAt: o.completed_at,
    createdAt: o.created_at,
  };
}

export async function orderRoutes(app: FastifyInstance) {
  const { db, payments } = app.deps;
  const now = () => app.deps.clock();

  async function loadFor(id: string, userId: string) {
    const o = await one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    if (!o || (o.buyer_id !== userId && o.seller_id !== userId)) throw notFound('Ordine non trovato');
    return o;
  }

  app.get('/orders', async (req) => {
    const user = requireUser(req);
    const { role } = parse(z.object({ role: z.enum(['buyer', 'seller']).default('buyer') }), req.query);
    const rows = await many<OrderRow>(db, `${ORDER_SELECT} WHERE o.${role}_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [user.id]);
    return { orders: rows.map((o) => view(o, user.id)) };
  });

  app.get('/orders/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    return { order: view(await loadFor(id, user.id), user.id) };
  });

  // Il compratore indica l'indirizzo e riceve il client secret per il pagamento con Stripe.
  app.post('/orders/:id/pay', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    const { shippingAddress } = parse(z.object({ shippingAddress: addressSchema }), req.body);
    const t = now();
    return tx(db, async (c) => {
      const o = await one<OrderRow>(c, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!o || o.buyer_id !== user.id) throw notFound('Ordine non trovato');
      if (o.status !== 'awaiting_payment') throw conflict('not_payable', 'Questo ordine non è in attesa di pagamento');
      if (o.payment_due_at <= t) throw conflict('payment_expired', 'Il termine per il pagamento è scaduto');
      await c.query('UPDATE orders SET shipping_address = $2, updated_at = $3 WHERE id = $1', [id, shippingAddress, t]);
      if (o.payment_intent_id) {
        return { clientSecret: await payments.paymentClientSecret(o.payment_intent_id), amount: o.total_amount };
      }
      const pi = await payments.createPayment({ orderId: id, amount: o.total_amount, buyerEmail: user.email });
      await c.query('UPDATE orders SET payment_intent_id = $2 WHERE id = $1', [id, pi.id]);
      return { clientSecret: pi.clientSecret, amount: o.total_amount };
    });
  });

  app.post('/orders/:id/ship', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(z.object({ carrier: z.string().trim().min(2).max(50), trackingNumber: z.string().trim().min(4).max(60) }), req.body);
    const t = now();
    const o = await one<OrderRow>(db, `
      UPDATE orders SET status = 'shipped', shipped_at = $3, tracking_carrier = $4, tracking_number = $5, updated_at = $3
      WHERE id = $1 AND seller_id = $2 AND status = 'paid' RETURNING *`, [id, user.id, t, body.carrier, body.trackingNumber]);
    if (!o) throw conflict('not_shippable', 'Ordine non trovato o non ancora pagato');
    await notifyUser(app, o.buyer_id, {
      subject: 'Il tuo acquisto è stato spedito',
      text: `Il venditore ha spedito l'oggetto con ${body.carrier}, tracking ${body.trackingNumber}.\nQuando lo ricevi conferma la consegna nell'app: solo allora il venditore riceve il pagamento.`,
      data: { orderId: id, type: 'shipped' },
    });
    return { order: view(await loadFor(id, user.id), user.id) };
  });

  app.post('/orders/:id/confirm-delivery', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    const o = await one<OrderRow>(db, 'SELECT * FROM orders WHERE id = $1', [id]);
    if (!o || o.buyer_id !== user.id) throw notFound('Ordine non trovato');
    if (o.status !== 'shipped') throw conflict('not_shipped', "L'ordine non risulta spedito");
    await releasePayout(app, id, 'buyer_confirmed');
    return { order: view(await loadFor(id, user.id), user.id) };
  });

  // La contestazione blocca il rilascio dei fondi finché un amministratore non decide.
  app.post('/orders/:id/dispute', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(2000) }), req.body);
    const t = now();
    const o = await one<OrderRow>(db, `
      UPDATE orders SET status = 'disputed', dispute_reason = $3, updated_at = $4
      WHERE id = $1 AND buyer_id = $2 AND status IN ('paid', 'shipped') RETURNING *`, [id, user.id, reason, t]);
    if (!o) throw conflict('not_disputable', 'Questo ordine non può essere contestato');
    await audit(db, { userId: user.id, action: 'order_disputed', ip: req.ip, meta: { orderId: id } }, t);
    await notifyUser(app, o.seller_id, {
      subject: 'Un acquirente ha aperto una contestazione',
      text: `L'acquirente ha segnalato un problema con l'ordine "${id}". Il pagamento resta sospeso finché l'assistenza non verifica.\n\nMotivo: ${reason}`,
      data: { orderId: id, type: 'dispute' },
    });
    return { order: view(await loadFor(id, user.id), user.id) };
  });

  app.post('/orders/:id/review', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default('') }), req.body);
    const o = await one<OrderRow>(db, 'SELECT * FROM orders WHERE id = $1', [id]);
    if (!o || o.buyer_id !== user.id) throw notFound('Ordine non trovato');
    if (o.status !== 'completed') throw conflict('not_completed', 'Puoi lasciare una recensione dopo la consegna');
    const r = await one(db, `INSERT INTO reviews (order_id, seller_id, reviewer_id, rating, comment, created_at)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING order_id`, [id, o.seller_id, user.id, body.rating, body.comment, now()]);
    if (!r) throw conflict('already_reviewed', 'Hai già recensito questo ordine');
    return reply.code(201).send({ status: 'saved' });
  });

  app.post('/admin/orders/:id/resolve', async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const { action, note } = parse(z.object({ action: z.enum(['refund', 'release']), note: z.string().max(2000).default('') }), req.body);
    const o = await one<OrderRow>(db, 'SELECT * FROM orders WHERE id = $1', [id]);
    if (!o) throw notFound('Ordine non trovato');
    if (!['disputed', 'paid', 'shipped'].includes(o.status)) throw conflict('not_resolvable', 'Ordine non contestabile in questo stato');
    if (action === 'release') await releasePayout(app, id, 'admin');
    else await refundOrder(app, id);
    await audit(db, { userId: admin.id, action: `admin_order_${action}`, ip: req.ip, meta: { orderId: id, note } }, now());
    return { status: action === 'release' ? 'completed' : 'refunded' };
  });

  // Webhook Stripe: corpo grezzo per verificare la firma, idempotente sugli id evento.
  app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hook.post('/webhooks/payments', { config: { rateLimit: false } }, async (req, reply) => {
      let event: PaymentEvent;
      try {
        event = payments.parseWebhook(req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
      } catch (err) {
        if (err instanceof WebhookSignatureError) throw new AppError(400, 'invalid_signature', err.message);
        throw err;
      }
      await handlePaymentEvent(app, event);
      return reply.send({ received: true });
    });
  });
}

export async function handlePaymentEvent(app: FastifyInstance, event: PaymentEvent) {
  const { db } = app.deps;
  const t = app.deps.clock();
  const after: (() => Promise<void>)[] = [];
  await tx(db, async (c) => {
    const fresh = await one(c, 'INSERT INTO payment_events (id, type, processed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id',
      [event.id, event.kind, t]);
    if (!fresh) return; // già elaborato

    if (event.kind === 'payment_succeeded') {
      const o = await one<OrderRow>(c, 'SELECT * FROM orders WHERE payment_intent_id = $1 FOR UPDATE', [event.paymentIntentId]);
      if (!o) {
        app.log.warn({ event }, 'pagamento senza ordine');
        return;
      }
      if (event.amount !== o.total_amount) {
        app.log.error({ event, orderId: o.id }, 'importo pagato diverso dal totale');
        await audit(c, { action: 'payment_amount_mismatch', meta: { orderId: o.id, paid: event.amount } }, t);
        return;
      }
      if (o.status === 'cancelled') {
        // Pagamento arrivato dopo la scadenza: rimborso automatico.
        after.push(() => refundOrder(app, o.id, true));
        return;
      }
      if (o.status !== 'awaiting_payment') return;
      await c.query("UPDATE orders SET status = 'paid', paid_at = $2, updated_at = $2 WHERE id = $1", [o.id, t]);
      after.push(() => notifyUser(app, o.seller_id, {
        subject: 'Pagamento ricevuto: puoi spedire',
        text: `L'acquirente ha pagato l'ordine ${o.id}. Spedisci l'oggetto e inserisci il tracking nell'app.\nRiceverai ${formatEuro(o.item_amount + o.shipping_amount - o.seller_fee)} dopo la conferma di consegna.`,
        data: { orderId: o.id, type: 'paid' },
      }));
    } else if (event.kind === 'account_updated') {
      await c.query('UPDATE seller_profiles SET payouts_enabled = $2, updated_at = $3 WHERE stripe_account_id = $1', [event.accountId, event.payoutsEnabled, t]);
    } else if (event.kind === 'dispute_created') {
      // Chargeback aperto presso la banca: il rilascio dei fondi si blocca.
      await c.query("UPDATE orders SET status = 'disputed', dispute_reason = COALESCE(dispute_reason, 'Contestazione bancaria (chargeback)'), updated_at = $2 WHERE payment_intent_id = $1 AND status IN ('paid', 'shipped')",
        [event.paymentIntentId, t]);
      await audit(c, { action: 'chargeback', meta: { paymentIntentId: event.paymentIntentId } }, t);
    }
  });
  for (const fn of after) await fn();
}

export async function releasePayout(app: FastifyInstance, orderId: string, reason: string) {
  const { db, payments } = app.deps;
  const t = app.deps.clock();
  const o = await tx(db, async (c) => {
    const o = await one<OrderRow & { stripe_account_id: string | null }>(c, `
      SELECT o.*, sp.stripe_account_id FROM orders o LEFT JOIN seller_profiles sp ON sp.user_id = o.seller_id
      WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
    if (!o || !['shipped', 'disputed', 'paid'].includes(o.status)) throw conflict('not_releasable', 'Ordine non rilasciabile');
    if (!o.stripe_account_id || !o.payment_intent_id) throw new AppError(500, 'payout_unavailable', 'Conto del venditore non disponibile');
    // Il transfer ha una chiave di idempotenza: se la transazione fallisce dopo, ripeterlo è sicuro.
    const transferId = await payments.transfer({
      orderId, amount: o.item_amount + o.shipping_amount - o.seller_fee, destination: o.stripe_account_id, paymentIntentId: o.payment_intent_id,
    });
    await c.query("UPDATE orders SET status = 'completed', transfer_id = $2, completed_at = $3, updated_at = $3 WHERE id = $1", [orderId, transferId, t]);
    await audit(c, { action: 'payout_released', meta: { orderId, reason } }, t);
    return o;
  });
  await notifyUser(app, o.seller_id, {
    subject: 'Pagamento in arrivo',
    text: `L'ordine ${orderId} è concluso: ${formatEuro(o.item_amount + o.shipping_amount - o.seller_fee)} sono stati trasferiti sul tuo conto.`,
    data: { orderId, type: 'payout' },
  });
}

export async function refundOrder(app: FastifyInstance, orderId: string, latePayment = false) {
  const { db, payments } = app.deps;
  const t = app.deps.clock();
  const o = await tx(db, async (c) => {
    const o = await one<OrderRow>(c, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!o?.payment_intent_id) throw badRequest('not_paid', 'Nessun pagamento da rimborsare');
    if (o.status === 'refunded' || o.status === 'completed') throw conflict('not_refundable', 'Ordine non rimborsabile');
    const refundId = await payments.refund({ orderId, paymentIntentId: o.payment_intent_id });
    await c.query("UPDATE orders SET status = 'refunded', refund_id = $2, updated_at = $3 WHERE id = $1", [orderId, refundId, t]);
    await audit(c, { action: 'order_refunded', meta: { orderId, latePayment } }, t);
    return o;
  });
  await notifyUser(app, o.buyer_id, {
    subject: 'Rimborso effettuato',
    text: `Ti abbiamo rimborsato ${formatEuro(o.total_amount)} per l'ordine ${orderId}. L'accredito può richiedere alcuni giorni.`,
    data: { orderId, type: 'refund' },
  });
}
