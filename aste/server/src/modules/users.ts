import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit, parse, requireUser, requireVerified, uuidParam } from '../lib/http.js';
import { verifyPassword } from '../services/password.js';
import { displayNameSchema, revokeAllSessions } from './auth.js';

// Paesi in cui un venditore può ricevere incassi (SEPA, supportati da Stripe Connect).
const SELLER_COUNTRIES = ['IT', 'AT', 'BE', 'DE', 'ES', 'FR', 'IE', 'LU', 'NL', 'PT', 'SM'] as const;

const sellerBody = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('private'),
    legalName: z.string().trim().min(3).max(120),
    taxCode: z.string().trim().max(32).optional(),
    addressLine: z.string().trim().min(3).max(200),
    city: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(12),
    country: z.enum(SELLER_COUNTRIES),
  }),
  z.object({
    type: z.literal('business'),
    legalName: z.string().trim().min(2).max(200),
    vatNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[0-9A-Z]{8,12}$/, 'Partita IVA con prefisso del paese, es. IT12345678901'),
    taxCode: z.string().trim().max(32).optional(),
    addressLine: z.string().trim().min(3).max(200),
    city: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(12),
    country: z.enum(SELLER_COUNTRIES),
    phone: z.string().trim().regex(/^\+?[0-9 ]{6,20}$/, 'Numero di telefono non valido'),
    businessEmail: z.email().max(254),
  }),
]);

const OPEN_ORDER_STATUSES = "('awaiting_payment', 'paid', 'shipped', 'disputed')";

export async function userRoutes(app: FastifyInstance) {
  const { db, payments, config } = app.deps;
  const now = () => app.deps.clock();

  app.get('/me', async (req) => {
    const user = requireUser(req);
    const row = await one<{ created_at: Date }>(db, 'SELECT created_at FROM users WHERE id = $1', [user.id]);
    const seller = await one<{ type: string; payouts_enabled: boolean }>(db, 'SELECT type, payouts_enabled FROM seller_profiles WHERE user_id = $1', [user.id]);
    return {
      user: {
        id: user.id, email: user.email, displayName: user.displayName, role: user.role,
        emailVerified: user.emailVerified, createdAt: row?.created_at,
        seller: seller ? { type: seller.type, payoutsEnabled: seller.payouts_enabled } : null,
      },
    };
  });

  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const { displayName } = parse(z.object({ displayName: displayNameSchema }), req.body);
    const row = await one(db, 'UPDATE users SET display_name = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE display_name = $2 AND id <> $1) RETURNING id', [user.id, displayName]);
    if (!row) throw conflict('display_name_taken', 'Nome utente già in uso');
    return { displayName };
  });

  app.delete('/me/push-tokens/:token', async (req, reply) => {
    const user = requireUser(req);
    const { token } = parse(z.object({ token: z.string().min(10).max(300) }), req.params);
    await db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, user.id]);
    return reply.code(204).send();
  });

  app.get('/me/seller', async (req) => {
    const user = requireUser(req);
    const p = await one(db, `SELECT type, legal_name AS "legalName", vat_number AS "vatNumber", tax_code AS "taxCode",
      address_line AS "addressLine", city, postal_code AS "postalCode", country, phone, business_email AS "businessEmail",
      payouts_enabled AS "payoutsEnabled" FROM seller_profiles WHERE user_id = $1`, [user.id]);
    return { seller: p ?? null };
  });

  app.put('/me/seller', async (req) => {
    const user = requireVerified(req);
    const body = parse(sellerBody, req.body);
    const t = now();
    const existing = await one<{ type: string; stripe_account_id: string | null }>(db, 'SELECT type, stripe_account_id FROM seller_profiles WHERE user_id = $1', [user.id]);
    if (existing?.stripe_account_id && existing.type !== body.type) {
      throw conflict('seller_type_locked', 'Il tipo di venditore non si può cambiare dopo la verifica dei pagamenti: contatta l\'assistenza');
    }
    const b = body.type === 'business' ? body : { ...body, vatNumber: null, phone: null, businessEmail: null };
    await db.query(`
      INSERT INTO seller_profiles (user_id, type, legal_name, vat_number, tax_code, address_line, city, postal_code, country, phone, business_email, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
      ON CONFLICT (user_id) DO UPDATE SET type = $2, legal_name = $3, vat_number = $4, tax_code = $5, address_line = $6,
        city = $7, postal_code = $8, country = $9, phone = $10, business_email = $11, updated_at = $12`,
    [user.id, b.type, b.legalName, b.vatNumber, b.taxCode ?? null, b.addressLine, b.city, b.postalCode, b.country, b.phone, b.businessEmail, t]);
    await audit(db, { userId: user.id, action: 'seller_profile_saved', ip: req.ip, meta: { type: b.type } }, t);
    return { status: 'saved' };
  });

  // Verifica d'identità e conto per gli incassi: la gestisce Stripe con una pagina ospitata.
  app.post('/me/seller/onboarding', async (req) => {
    const user = requireVerified(req);
    const p = await one<{ type: string; country: string; stripe_account_id: string | null }>(db,
      'SELECT type, country, stripe_account_id FROM seller_profiles WHERE user_id = $1', [user.id]);
    if (!p) throw badRequest('seller_profile_required', 'Completa prima il tuo profilo venditore');
    let accountId = p.stripe_account_id;
    if (!accountId) {
      accountId = await payments.createSellerAccount({ email: user.email, country: p.country, business: p.type === 'business', userId: user.id });
      await db.query('UPDATE seller_profiles SET stripe_account_id = $2, updated_at = $3 WHERE user_id = $1', [user.id, accountId, now()]);
    }
    const url = await payments.onboardingLink(accountId, `${config.PUBLIC_URL}/seller/onboarding/done`, `${config.PUBLIC_URL}/seller/onboarding/retry`);
    return { url };
  });

  app.post('/me/seller/refresh', async (req) => {
    const user = requireUser(req);
    const p = await one<{ stripe_account_id: string | null }>(db, 'SELECT stripe_account_id FROM seller_profiles WHERE user_id = $1', [user.id]);
    if (!p?.stripe_account_id) return { payoutsEnabled: false };
    const enabled = await payments.payoutsEnabled(p.stripe_account_id);
    await db.query('UPDATE seller_profiles SET payouts_enabled = $2, updated_at = $3 WHERE user_id = $1', [user.id, enabled, now()]);
    return { payoutsEnabled: enabled };
  });

  app.put('/me/push-tokens', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']) }), req.body);
    await db.query(`INSERT INTO push_tokens (token, user_id, platform, created_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $3`, [body.token, user.id, body.platform, now()]);
    return reply.code(204).send();
  });

  // Profilo pubblico. Per i professionisti mostra i dati richiesti dal DSA (art. 30)
  // e dalla direttiva Omnibus, così l'acquirente sa se ha i diritti del consumatore.
  app.get('/users/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const u = await one<{ id: string; display_name: string; created_at: Date; status: string }>(db,
      'SELECT id, display_name, created_at, status FROM users WHERE id = $1', [id]);
    if (!u || u.status === 'deleted') throw notFound('Utente non trovato');
    const p = await one<{ type: string; legal_name: string; vat_number: string | null; address_line: string; city: string; postal_code: string; country: string; phone: string | null; business_email: string | null }>(db,
      'SELECT * FROM seller_profiles WHERE user_id = $1', [id]);
    const stats = await one<{ avg: number | null; count: number }>(db, 'SELECT avg(rating)::float AS avg, count(*)::int AS count FROM reviews WHERE seller_id = $1', [id]);
    const sold = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM orders WHERE seller_id = $1 AND status = 'completed'", [id]);
    const reviews = await many(db, `
      SELECT r.rating, r.comment, r.created_at AS "createdAt", u.display_name AS reviewer
      FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.seller_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [id]);
    return {
      user: {
        id: u.id,
        displayName: u.display_name,
        memberSince: u.created_at,
        suspended: u.status === 'suspended',
        sellerType: p?.type ?? null,
        business: p?.type === 'business' ? {
          legalName: p.legal_name, vatNumber: p.vat_number, address: `${p.address_line}, ${p.postal_code} ${p.city} (${p.country})`,
          phone: p.phone, email: p.business_email,
        } : null,
        rating: stats?.count ? { average: Math.round(stats.avg! * 10) / 10, count: stats.count } : null,
        completedSales: sold?.n ?? 0,
        reviews,
      },
    };
  });

  // Portabilità dei dati (GDPR art. 20).
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = requireUser(req);
    const q = (sql: string) => many(db, sql, [user.id]);
    const data = {
      exportedAt: now(),
      account: await one(db, 'SELECT id, email, display_name, email_verified_at, terms_version, terms_accepted_at, created_at FROM users WHERE id = $1', [user.id]),
      sellerProfile: await one(db, 'SELECT type, legal_name, vat_number, tax_code, address_line, city, postal_code, country, phone, business_email, created_at FROM seller_profiles WHERE user_id = $1', [user.id]),
      auctions: await q('SELECT id, title, description, condition, starting_price, reserve_price, shipping_price, current_price, status, starts_at, ends_at, created_at FROM auctions WHERE seller_id = $1'),
      bids: await q('SELECT auction_id, amount, max_amount, is_auto, created_at FROM bids WHERE bidder_id = $1'),
      orders: await q('SELECT id, auction_id, buyer_id = $1 AS as_buyer, item_amount, shipping_amount, buyer_fee, seller_fee, total_amount, status, created_at FROM orders WHERE buyer_id = $1 OR seller_id = $1'),
      reviewsWritten: await q('SELECT order_id, rating, comment, created_at FROM reviews WHERE reviewer_id = $1'),
      watchlist: await q('SELECT auction_id, created_at FROM watchlist WHERE user_id = $1'),
      sessions: await q('SELECT created_at, user_agent, ip, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100'),
    };
    return reply.header('Content-Disposition', 'attachment; filename="i-miei-dati.json"').send(data);
  });

  // Cancellazione dell'account (GDPR art. 17; obbligatoria in-app per App Store e Play Store).
  // I dati degli ordini restano per gli obblighi fiscali (art. 17.3.b), il resto viene anonimizzato.
  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
    const row = await one<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, password))) throw badRequest('wrong_password', 'Password non corretta');
    const t = now();

    await tx(db, async (c) => {
      const blockers = await one<{ selling: number; leading: number; orders: number }>(c, `
        SELECT
          (SELECT count(*)::int FROM auctions WHERE seller_id = $1 AND status = 'active' AND bid_count > 0) AS selling,
          (SELECT count(*)::int FROM auctions WHERE leader_id = $1 AND status = 'active') AS leading,
          (SELECT count(*)::int FROM orders WHERE (buyer_id = $1 OR seller_id = $1) AND status IN ${OPEN_ORDER_STATUSES}) AS orders`, [user.id]);
      if (blockers!.selling || blockers!.leading || blockers!.orders) {
        throw conflict('account_has_open_activity',
          'Prima di eliminare l\'account concludi le aste in corso con offerte, le aste in cui sei in testa e gli ordini aperti');
      }
      await c.query("UPDATE auctions SET status = 'cancelled', closed_at = $2, updated_at = $2 WHERE seller_id = $1 AND status IN ('draft', 'active')", [user.id, t]);
      await c.query('DELETE FROM watchlist WHERE user_id = $1', [user.id]);
      await c.query('DELETE FROM push_tokens WHERE user_id = $1', [user.id]);
      await c.query('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [user.id]);
      await c.query('DELETE FROM email_tokens WHERE user_id = $1', [user.id]);
      const hasOrders = await one(c, 'SELECT 1 FROM orders WHERE seller_id = $1', [user.id]);
      if (!hasOrders) await c.query('DELETE FROM seller_profiles WHERE user_id = $1', [user.id]);
      const short = user.id.slice(0, 8);
      await c.query(`
        UPDATE users SET email = $2, display_name = $3, password_hash = NULL, status = 'deleted', deleted_at = $4
        WHERE id = $1`, [user.id, `eliminato-${user.id}@invalid`, `utente-eliminato-${short}`, t]);
      await revokeAllSessions(c, user.id, t);
      await c.query('UPDATE sessions SET user_agent = NULL, ip = NULL WHERE user_id = $1', [user.id]);
      await audit(c, { userId: user.id, action: 'account_deleted' }, t);
    });
    return reply.code(204).send();
  });
}
