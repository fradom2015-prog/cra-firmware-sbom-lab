import type { FastifyInstance } from 'fastify';
import { many, tx } from './db/pool.js';
import { formatEuro, orderAmounts } from './lib/money.js';
import { audit } from './lib/http.js';
import { notifyUser } from './services/notify.js';
import { releasePayout } from './modules/orders.js';

interface Ended {
  id: string;
  title: string;
  seller_id: string;
  leader_id: string | null;
  current_price: number | null;
  reserve_price: number | null;
  shipping_price: number;
  status: 'ended_sold' | 'ended_unsold';
}

// Chiude le aste scadute e crea gli ordini per i vincitori. SKIP LOCKED permette
// di eseguire il job su più istanze senza chiudere due volte la stessa asta.
export async function closeEndedAuctions(app: FastifyInstance): Promise<number> {
  const { db, config } = app.deps;
  const t = app.deps.clock();
  const dueAt = new Date(t.getTime() + config.PAYMENT_DUE_DAYS * 86_400_000);

  const closed = await tx(db, async (c) => {
    const rows = await many<Ended>(c, `
      UPDATE auctions a SET
        status = CASE WHEN a.leader_id IS NOT NULL AND (a.reserve_price IS NULL OR a.current_price >= a.reserve_price)
                      THEN 'ended_sold'::auction_status ELSE 'ended_unsold'::auction_status END,
        closed_at = $1, updated_at = $1
      WHERE a.id IN (
        SELECT id FROM auctions WHERE status = 'active' AND ends_at <= $1 ORDER BY ends_at LIMIT 100 FOR UPDATE SKIP LOCKED)
      RETURNING a.id, a.title, a.seller_id, a.leader_id, a.current_price, a.reserve_price, a.shipping_price, a.status`, [t]);
    for (const a of rows) {
      if (a.status !== 'ended_sold') continue;
      const m = orderAmounts(a.current_price!, a.shipping_price, config.BUYER_FEE_BPS, config.SELLER_FEE_BPS);
      await c.query(`
        INSERT INTO orders (auction_id, buyer_id, seller_id, item_amount, shipping_amount, buyer_fee, seller_fee, total_amount, payment_due_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [a.id, a.leader_id, a.seller_id, m.itemAmount, m.shippingAmount, m.buyerFee, m.sellerFee, m.totalAmount, dueAt, t]);
    }
    return rows;
  });

  for (const a of closed) {
    await app.deps.bus.publish(`auction:${a.id}`, { type: 'ended', auctionId: a.id, status: a.status });
    if (a.status === 'ended_sold') {
      const m = orderAmounts(a.current_price!, a.shipping_price, config.BUYER_FEE_BPS, config.SELLER_FEE_BPS);
      await notifyUser(app, a.leader_id!, {
        subject: `Hai vinto: ${a.title}`,
        text: `Complimenti! Hai vinto "${a.title}" a ${formatEuro(a.current_price!)}.\nTotale da pagare (spedizione e protezione acquisti incluse): ${formatEuro(m.totalAmount)}.\nPaga dall'app entro ${config.PAYMENT_DUE_DAYS} giorni.`,
        data: { auctionId: a.id, type: 'won' },
      });
      await notifyUser(app, a.seller_id, {
        subject: `Venduto: ${a.title}`,
        text: `"${a.title}" è stato venduto a ${formatEuro(a.current_price!)}. Ti avviseremo appena l'acquirente paga: solo allora dovrai spedire.`,
        data: { auctionId: a.id, type: 'sold' },
      });
    } else {
      const reason = a.leader_id ? 'il prezzo di riserva non è stato raggiunto' : 'non ha ricevuto offerte';
      await notifyUser(app, a.seller_id, { subject: `Asta conclusa senza vendita: ${a.title}`, text: `L'asta "${a.title}" si è chiusa: ${reason}.`, data: { auctionId: a.id, type: 'unsold' } });
    }
  }
  return closed.length;
}

// Ordini non pagati entro la scadenza: annullati.
export async function cancelUnpaidOrders(app: FastifyInstance): Promise<number> {
  const t = app.deps.clock();
  const rows = await many<{ id: string; buyer_id: string; seller_id: string }>(app.deps.db, `
    UPDATE orders SET status = 'cancelled', updated_at = $1
    WHERE status = 'awaiting_payment' AND payment_due_at <= $1 RETURNING id, buyer_id, seller_id`, [t]);
  for (const o of rows) {
    await audit(app.deps.db, { userId: o.buyer_id, action: 'order_unpaid', meta: { orderId: o.id } }, t);
    await notifyUser(app, o.seller_id, { subject: 'Ordine annullato per mancato pagamento', text: `L'acquirente non ha pagato l'ordine ${o.id} entro la scadenza. L'ordine è annullato e puoi rimettere in vendita l'oggetto.` });
    await notifyUser(app, o.buyer_id, { subject: 'Ordine annullato', text: `L'ordine ${o.id} è stato annullato perché non è stato pagato entro la scadenza.` });
  }
  return rows.length;
}

// Spedizioni senza contestazioni dopo AUTO_RELEASE_DAYS: i fondi vanno al venditore.
export async function autoReleasePayouts(app: FastifyInstance): Promise<number> {
  const cutoff = new Date(app.deps.clock().getTime() - app.deps.config.AUTO_RELEASE_DAYS * 86_400_000);
  const rows = await many<{ id: string }>(app.deps.db, "SELECT id FROM orders WHERE status = 'shipped' AND shipped_at <= $1 LIMIT 100", [cutoff]);
  let n = 0;
  for (const o of rows) {
    try {
      await releasePayout(app, o.id, 'auto_release');
      n++;
    } catch (err) {
      app.log.error({ err, orderId: o.id }, 'rilascio automatico fallito');
    }
  }
  return n;
}

export function startJobs(app: FastifyInstance) {
  const run = (name: string, fn: (app: FastifyInstance) => Promise<number>) => async () => {
    try {
      await fn(app);
    } catch (err) {
      app.log.error({ err }, `job ${name} fallito`);
    }
  };
  const timers = [
    setInterval(run('close', closeEndedAuctions), 5_000),
    setInterval(run('unpaid', cancelUnpaidOrders), 60_000),
    setInterval(run('release', autoReleasePayouts), 10 * 60_000),
  ];
  return () => timers.forEach(clearInterval);
}
