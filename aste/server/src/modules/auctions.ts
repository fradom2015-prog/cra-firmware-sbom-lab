import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import { z } from 'zod';
import { many, one, tx, type Queryable } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { formatEuro } from '../lib/money.js';
import { audit, parse, requireUser, requireVerified, uuidParam } from '../lib/http.js';
import { BidRejected, MAX_BID, minimumBid, reserveMet, resolveBid, type BidState } from './bidding.js';
import { notifyUser } from '../services/notify.js';

export const ANTI_SNIPING_MS = 2 * 60 * 1000;
const MAX_IMAGES = 10;
const PAGE_SIZE = 24;

const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
const cents = (min: number) => z.number().int('Importo in centesimi interi').min(min).max(MAX_BID);

const draftFields = z.object({
  categorySlug: z.string().max(50),
  title: z.string().trim().min(5, 'Titolo di almeno 5 caratteri').max(100),
  description: z.string().trim().max(10_000),
  condition: z.enum(CONDITIONS),
  startingPrice: cents(100),
  reservePrice: cents(100).nullable(),
  shippingPrice: cents(0),
  durationDays: z.number().int().min(1).max(14),
});
const draftBody = draftFields.extend({
  reservePrice: draftFields.shape.reservePrice.default(null),
  shippingPrice: draftFields.shape.shippingPrice.default(0),
  durationDays: draftFields.shape.durationDays.default(7),
});
// In Zod 4 i default valgono anche dentro partial(): la PATCH usa i campi senza default,
// altrimenti cambiare solo il titolo azzererebbe riserva, spedizione e durata.
const patchBody = draftFields.partial();

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(50).optional(),
  status: z.enum(['active', 'ended']).default('active'),
  sort: z.enum(['ending_soon', 'newest', 'price_asc', 'price_desc', 'relevance']).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

const bidBody = z.object({
  maxAmount: z.number().int('Importo in centesimi interi'),
  idempotencyKey: z.string().min(8).max(64).optional(),
});

interface AuctionRow {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_type: 'private' | 'business' | null;
  category_slug: string;
  category_name: string;
  title: string;
  description: string;
  condition: string;
  starting_price: number;
  reserve_price: number | null;
  shipping_price: number;
  duration_days: number;
  current_price: number | null;
  leader_id: string | null;
  leader_max: number | null;
  leader_name: string | null;
  bid_count: number;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
}

const AUCTION_SELECT = `
  SELECT a.*, s.display_name AS seller_name, sp.type AS seller_type,
         c.slug AS category_slug, c.name AS category_name, l.display_name AS leader_name
  FROM auctions a
  JOIN users s ON s.id = a.seller_id
  LEFT JOIN seller_profiles sp ON sp.user_id = a.seller_id
  JOIN categories c ON c.id = a.category_id
  LEFT JOIN users l ON l.id = a.leader_id`;

// Nomi degli offerenti mascherati in pubblico, come su eBay: "m***o".
export const maskName = (name: string) => `${name[0]}***${name[name.length - 1]}`;

const toState = (a: AuctionRow): BidState => ({
  startingPrice: a.starting_price, reservePrice: a.reserve_price, currentPrice: a.current_price,
  leaderId: a.leader_id, leaderMax: a.leader_max,
});

async function imagesOf(app: FastifyInstance, db: Queryable, auctionIds: string[]) {
  if (!auctionIds.length) return new Map<string, { id: string; url: string; width: number; height: number }[]>();
  const rows = await many<{ id: string; auction_id: string; storage_key: string; width: number; height: number }>(db,
    'SELECT id, auction_id, storage_key, width, height FROM auction_images WHERE auction_id = ANY($1) ORDER BY position', [auctionIds]);
  const map = new Map<string, { id: string; url: string; width: number; height: number }[]>();
  for (const r of rows) {
    const list = map.get(r.auction_id) ?? [];
    list.push({ id: r.id, url: app.deps.storage.url(r.storage_key), width: r.width, height: r.height });
    map.set(r.auction_id, list);
  }
  return map;
}

// Vista pubblica: mai il massimo segreto del leader né l'importo della riserva.
export function publicAuction(a: AuctionRow, images: { id: string; url: string; width: number; height: number }[], viewerId: string | null) {
  const s = toState(a);
  const open = a.status === 'active';
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    condition: a.condition,
    category: { slug: a.category_slug, name: a.category_name },
    seller: { id: a.seller_id, displayName: a.seller_name, type: a.seller_type },
    images,
    startingPrice: a.starting_price,
    currentPrice: a.current_price,
    minimumBid: open ? minimumBid(s) : null,
    shippingPrice: a.shipping_price,
    durationDays: a.duration_days,
    bidCount: a.bid_count,
    hasReserve: a.reserve_price != null,
    reserveMet: a.reserve_price == null ? null : reserveMet(s),
    leader: a.leader_name ? maskName(a.leader_name) : null,
    status: a.status,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    viewer: viewerId ? {
      isSeller: viewerId === a.seller_id,
      isLeader: viewerId === a.leader_id,
      // Il proprio massimo lo vede solo chi è in testa.
      maxBid: viewerId === a.leader_id ? a.leader_max : null,
    } : null,
  };
}

export async function loadAuction(app: FastifyInstance, db: Queryable, id: string, viewerId: string | null) {
  const a = await one<AuctionRow>(db, `${AUCTION_SELECT} WHERE a.id = $1`, [id]);
  if (!a) throw notFound('Asta non trovata');
  const images = (await imagesOf(app, db, [a.id])).get(a.id) ?? [];
  return { row: a, view: publicAuction(a, images, viewerId) };
}

async function listWith(app: FastifyInstance, where: string, params: unknown[], order: string, page: number, viewerId: string | null) {
  const rows = await many<AuctionRow & { total: number }>(app.deps.db,
    `${AUCTION_SELECT.replace('SELECT a.*', 'SELECT a.*, count(*) OVER() AS total')} WHERE ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params);
  const images = await imagesOf(app, app.deps.db, rows.map((r) => r.id));
  return {
    items: rows.map((r) => publicAuction(r, (images.get(r.id) ?? []).slice(0, 1), viewerId)),
    total: rows[0]?.total ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

async function ownedDraft(db: Queryable, id: string, userId: string) {
  const a = await one<{ seller_id: string; status: string }>(db, 'SELECT seller_id, status FROM auctions WHERE id = $1 FOR UPDATE', [id]);
  if (!a || a.seller_id !== userId) throw notFound('Asta non trovata');
  if (a.status !== 'draft') throw conflict('not_draft', "L'asta è già pubblicata: non si può modificare");
}

export async function auctionRoutes(app: FastifyInstance) {
  const { db, storage, bus } = app.deps;
  const now = () => app.deps.clock();

  async function categoryId(slug: string) {
    const c = await one<{ id: number }>(db, 'SELECT id FROM categories WHERE slug = $1', [slug]);
    if (!c) throw badRequest('invalid_category', 'Categoria non valida');
    return c.id;
  }

  async function broadcast(id: string) {
    const { view } = await loadAuction(app, db, id, null);
    await bus.publish(`auction:${id}`, { type: 'auction', auction: view });
  }

  app.get('/categories', async () => ({ categories: await many(db, 'SELECT slug, name FROM categories ORDER BY id') }));

  // Parametri pubblici che l'app mostra all'utente (commissioni, scadenze).
  app.get('/meta', async () => {
    const { config } = app.deps;
    return {
      buyerFeeBps: config.BUYER_FEE_BPS, sellerFeeBps: config.SELLER_FEE_BPS, paymentDueDays: config.PAYMENT_DUE_DAYS,
      autoReleaseDays: config.AUTO_RELEASE_DAYS, antiSnipingMinutes: ANTI_SNIPING_MS / 60_000, termsVersion: config.TERMS_VERSION,
    };
  });

  app.get('/auctions', async (req) => {
    const q = parse(searchQuery, req.query);
    const params: unknown[] = [];
    const where = [q.status === 'active' ? "a.status = 'active'" : "a.status IN ('ended_sold', 'ended_unsold')"];
    if (q.category) {
      params.push(q.category);
      where.push(`c.slug = $${params.length}`);
    }
    let relevance = '';
    if (q.q) {
      params.push(q.q);
      where.push(`a.search @@ websearch_to_tsquery('italian', $${params.length})`);
      relevance = `ts_rank(a.search, websearch_to_tsquery('italian', $${params.length})) DESC, `;
    }
    const sort = q.sort ?? (q.q ? 'relevance' : q.status === 'active' ? 'ending_soon' : 'newest');
    const order = {
      relevance: `${relevance}a.ends_at ASC`,
      ending_soon: 'a.ends_at ASC',
      newest: 'a.starts_at DESC',
      price_asc: 'COALESCE(a.current_price, a.starting_price) ASC',
      price_desc: 'COALESCE(a.current_price, a.starting_price) DESC',
    }[sort];
    return listWith(app, where.join(' AND '), params, `${order}, a.id`, q.page, req.user?.id ?? null);
  });

  app.get('/auctions/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { row, view } = await loadAuction(app, db, id, req.user?.id ?? null);
    // Le bozze le vede solo il venditore; le aste rimosse nessuno.
    if ((row.status === 'draft' && row.seller_id !== req.user?.id) || row.status === 'removed') throw notFound('Asta non trovata');
    const watching = req.user ? !!(await one(db, 'SELECT 1 FROM watchlist WHERE user_id = $1 AND auction_id = $2', [req.user.id, id])) : false;
    return { auction: view, watching };
  });

  app.get('/auctions/:id/bids', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const bids = await many<{ id: number; amount: number; is_auto: boolean; created_at: Date; bidder_id: string; display_name: string }>(db, `
      SELECT b.id, b.amount, b.is_auto, b.created_at, b.bidder_id, u.display_name
      FROM bids b JOIN users u ON u.id = b.bidder_id
      WHERE b.auction_id = $1 AND b.visible ORDER BY b.id DESC LIMIT 50`, [id]);
    return {
      bids: bids.map((b) => ({
        id: b.id, amount: b.amount, isAuto: b.is_auto, createdAt: b.created_at,
        bidder: maskName(b.display_name), isMine: b.bidder_id === req.user?.id,
      })),
    };
  });

  app.post('/auctions', async (req, reply) => {
    const user = requireVerified(req);
    const body = parse(draftBody, req.body);
    if (body.reservePrice != null && body.reservePrice < body.startingPrice) {
      throw badRequest('invalid_reserve', 'Il prezzo di riserva non può essere inferiore al prezzo di partenza');
    }
    const t = now();
    const row = await one<{ id: string }>(db, `
      INSERT INTO auctions (seller_id, category_id, title, description, condition, starting_price, reserve_price, shipping_price, duration_days, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [user.id, await categoryId(body.categorySlug), body.title, body.description, body.condition,
      body.startingPrice, body.reservePrice, body.shippingPrice, body.durationDays, t]);
    return reply.code(201).send({ auction: (await loadAuction(app, db, row!.id, user.id)).view });
  });

  app.patch('/auctions/:id', async (req) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(patchBody, req.body);
    await tx(db, async (c) => {
      await ownedDraft(c, id, user.id);
      const cur = await one<{ starting_price: number; reserve_price: number | null }>(c, 'SELECT starting_price, reserve_price FROM auctions WHERE id = $1', [id]);
      const starting = body.startingPrice ?? cur!.starting_price;
      const reserve = body.reservePrice !== undefined ? body.reservePrice : cur!.reserve_price;
      if (reserve != null && reserve < starting) throw badRequest('invalid_reserve', 'Il prezzo di riserva non può essere inferiore al prezzo di partenza');
      await c.query(`
        UPDATE auctions SET
          category_id = COALESCE($2, category_id), title = COALESCE($3, title), description = COALESCE($4, description),
          condition = COALESCE($5, condition), starting_price = $6, reserve_price = $7,
          shipping_price = COALESCE($8, shipping_price), duration_days = COALESCE($9, duration_days), updated_at = $10
        WHERE id = $1`,
      [id, body.categorySlug ? await categoryId(body.categorySlug) : null, body.title ?? null, body.description ?? null,
        body.condition ?? null, starting, reserve, body.shippingPrice ?? null, body.durationDays ?? null, now()]);
    });
    return { auction: (await loadAuction(app, db, id, user.id)).view };
  });

  app.delete('/auctions/:id', async (req, reply) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    const keys = await tx(db, async (c) => {
      await ownedDraft(c, id, user.id);
      const imgs = await many<{ storage_key: string }>(c, 'DELETE FROM auction_images WHERE auction_id = $1 RETURNING storage_key', [id]);
      await c.query('DELETE FROM watchlist WHERE auction_id = $1', [id]);
      await c.query('DELETE FROM auctions WHERE id = $1', [id]);
      return imgs.map((i) => i.storage_key);
    });
    await Promise.all(keys.map((k) => storage.delete(k)));
    return reply.code(204).send();
  });

  app.post('/auctions/:id/images', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    await tx(db, (c) => ownedDraft(c, id, user.id));
    const file = await req.file();
    if (!file) throw badRequest('missing_file', 'Nessun file ricevuto');
    const input = await file.toBuffer();
    if (file.file.truncated) throw new AppError(413, 'file_too_large', 'Immagine troppo grande (max 10 MB)');

    // Ricodifica completa: valida il formato, applica la rotazione EXIF, ridimensiona e
    // rimuove tutti i metadati (posizione GPS inclusa) e qualsiasi contenuto estraneo.
    let output: { data: Buffer; info: OutputInfo };
    try {
      const meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(meta.format)) throw new Error('formato');
      output = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw badRequest('invalid_image', 'Formato immagine non supportato (usa JPEG, PNG o WebP)');
    }

    const key = `${id}/${randomUUID()}.webp`;
    await storage.put(key, output.data, 'image/webp');
    try {
      const image = await tx(db, async (c) => {
        await ownedDraft(c, id, user.id);
        const { n } = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM auction_images WHERE auction_id = $1', [id]))!;
        if (n >= MAX_IMAGES) throw conflict('too_many_images', `Massimo ${MAX_IMAGES} immagini per asta`);
        return one<{ id: string }>(c, `
          INSERT INTO auction_images (auction_id, position, storage_key, width, height)
          VALUES ($1, (SELECT COALESCE(max(position), -1) + 1 FROM auction_images WHERE auction_id = $1), $2, $3, $4) RETURNING id`,
        [id, key, output.info.width, output.info.height]);
      });
      return reply.code(201).send({ image: { id: image!.id, url: storage.url(key), width: output.info.width, height: output.info.height } });
    } catch (err) {
      await storage.delete(key);
      throw err;
    }
  });

  app.delete('/auctions/:id/images/:imageId', async (req, reply) => {
    const user = requireVerified(req);
    const { id, imageId } = parse(z.object({ id: z.uuid(), imageId: z.uuid() }), req.params);
    const key = await tx(db, async (c) => {
      await ownedDraft(c, id, user.id);
      const img = await one<{ storage_key: string }>(c, 'DELETE FROM auction_images WHERE id = $1 AND auction_id = $2 RETURNING storage_key', [imageId, id]);
      if (!img) throw notFound('Immagine non trovata');
      return img.storage_key;
    });
    await storage.delete(key);
    return reply.code(204).send();
  });

  app.post('/auctions/:id/publish', async (req) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    const t = now();
    await tx(db, async (c) => {
      await ownedDraft(c, id, user.id);
      const seller = await one<{ payouts_enabled: boolean }>(c, 'SELECT payouts_enabled FROM seller_profiles WHERE user_id = $1', [user.id]);
      if (!seller) throw forbidden('seller_profile_required', 'Completa prima il tuo profilo venditore');
      if (!seller.payouts_enabled) throw forbidden('payouts_not_enabled', 'Completa la verifica dei pagamenti per ricevere gli incassi');
      const { n } = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM auction_images WHERE auction_id = $1', [id]))!;
      if (n === 0) throw badRequest('images_required', 'Aggiungi almeno una foto');
      await c.query(`UPDATE auctions SET status = 'active', starts_at = $2, ends_at = $2::timestamptz + make_interval(days => duration_days), updated_at = $2 WHERE id = $1`, [id, t]);
      await audit(c, { userId: user.id, action: 'auction_published', ip: req.ip, meta: { auctionId: id } }, t);
    });
    return { auction: (await loadAuction(app, db, id, user.id)).view };
  });

  // Come su eBay: il venditore può ritirare l'asta solo finché non ci sono offerte.
  app.post('/auctions/:id/cancel', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    await tx(db, async (c) => {
      const a = await one<{ seller_id: string; status: string; bid_count: number }>(c, 'SELECT seller_id, status, bid_count FROM auctions WHERE id = $1 FOR UPDATE', [id]);
      if (!a || a.seller_id !== user.id) throw notFound('Asta non trovata');
      if (a.status !== 'active') throw conflict('not_active', "L'asta non è in corso");
      if (a.bid_count > 0) throw conflict('has_bids', "Non puoi ritirare un'asta che ha già ricevuto offerte");
      await c.query("UPDATE auctions SET status = 'cancelled', closed_at = $2, updated_at = $2 WHERE id = $1", [id, now()]);
    });
    await broadcast(id);
    return { auction: (await loadAuction(app, db, id, user.id)).view };
  });

  app.post('/auctions/:id/bids', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireVerified(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(bidBody, req.body);
    const t = now();

    const result = await tx(db, async (c) => {
      const a = await one<AuctionRow>(c, 'SELECT * FROM auctions WHERE id = $1 FOR UPDATE', [id]);
      if (!a || a.status === 'draft' || a.status === 'removed') throw notFound('Asta non trovata');
      // Ripetizione della stessa offerta (doppio tocco, rete instabile): controllata dopo il lock.
      if (body.idempotencyKey) {
        const dup = await one(c, 'SELECT 1 FROM bids WHERE bidder_id = $1 AND idempotency_key = $2', [user.id, body.idempotencyKey]);
        if (dup) return { duplicate: true as const };
      }
      if (a.status !== 'active' || !a.ends_at || t >= a.ends_at) throw conflict('auction_closed', "L'asta è chiusa");
      if (a.seller_id === user.id) throw forbidden('own_auction', 'Non puoi fare offerte sulla tua asta');
      if (await one(c, 'SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.seller_id, user.id])) {
        throw forbidden('blocked', 'Non puoi fare offerte su questa asta');
      }

      let outcome;
      try {
        outcome = resolveBid(toState(a), user.id, body.maxAmount);
      } catch (err) {
        if (!(err instanceof BidRejected)) throw err;
        const msg = {
          below_minimum: `L'offerta minima è ${formatEuro(err.minimum)}`,
          not_above_own_max: `Sei già in testa: per alzare il tuo massimo offri almeno ${formatEuro(err.minimum)}`,
          above_limit: 'Importo oltre il limite consentito',
          invalid_amount: 'Importo non valido',
        }[err.code];
        throw new AppError(400, err.code, msg);
      }

      let endsAt = a.ends_at;
      if (outcome.priceChanged && endsAt.getTime() - t.getTime() < ANTI_SNIPING_MS) {
        endsAt = new Date(t.getTime() + ANTI_SNIPING_MS);
      }
      const visibleRows = outcome.rows.filter((r) => r.visible).length;
      for (const [i, r] of outcome.rows.entries()) {
        // La chiave di idempotenza va sulla riga dell'offerente, non sui rilanci automatici.
        const key = r.bidderId === user.id && !r.isAuto ? body.idempotencyKey ?? null : null;
        await c.query(`
          INSERT INTO bids (auction_id, bidder_id, amount, max_amount, is_auto, visible, idempotency_key, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, r.bidderId, r.amount, r.maxAmount, r.isAuto, r.visible, key, new Date(t.getTime() + i)]);
      }
      await c.query(`
        UPDATE auctions SET current_price = $2, leader_id = $3, leader_max = $4, bid_count = bid_count + $5, ends_at = $6, updated_at = $7
        WHERE id = $1`,
      [id, outcome.state.currentPrice, outcome.state.leaderId, outcome.state.leaderMax, visibleRows, endsAt, t]);
      return { duplicate: false as const, outcome };
    });

    const { view } = await loadAuction(app, db, id, user.id);
    if (!result.duplicate) {
      await broadcast(id);
      const outbid = result.outcome.outbidUserId;
      if (outbid && outbid !== user.id) {
        await notifyUser(app, outbid, {
          subject: `Sei stato superato: ${view.title}`,
          text: `La tua offerta per "${view.title}" è stata superata. Offerta attuale: ${formatEuro(view.currentPrice!)}.\nRilancia prima della chiusura.`,
          data: { auctionId: id, type: 'outbid' },
        });
      }
    }
    // Se l'offerta è subito superata dal massimo del leader, il client lo mostra all'utente.
    return reply.code(result.duplicate ? 200 : 201).send({ auction: view, outbid: !view.viewer?.isLeader });
  });

  app.put('/auctions/:id/watch', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    if (!(await one(db, "SELECT 1 FROM auctions WHERE id = $1 AND status NOT IN ('draft', 'removed')", [id]))) throw notFound('Asta non trovata');
    await db.query('INSERT INTO watchlist (user_id, auction_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user.id, id, now()]);
    return reply.code(204).send();
  });

  app.delete('/auctions/:id/watch', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    await db.query('DELETE FROM watchlist WHERE user_id = $1 AND auction_id = $2', [user.id, id]);
    return reply.code(204).send();
  });

  // Le "mie" liste: aste come venditore, aste su cui ho offerto, osservate.
  const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(100).default(1) });

  app.get('/me/auctions', async (req) => {
    const user = requireUser(req);
    const { page } = parse(pageQuery, req.query);
    return listWith(app, "a.seller_id = $1 AND a.status <> 'removed'", [user.id], 'a.created_at DESC, a.id', page, user.id);
  });

  app.get('/me/bidding', async (req) => {
    const user = requireUser(req);
    const { page } = parse(pageQuery, req.query);
    return listWith(app, "a.id IN (SELECT auction_id FROM bids WHERE bidder_id = $1) AND a.status <> 'removed'", [user.id],
      "(a.status = 'active') DESC, a.ends_at DESC, a.id", page, user.id);
  });

  app.get('/me/watchlist', async (req) => {
    const user = requireUser(req);
    const { page } = parse(pageQuery, req.query);
    return listWith(app, "a.id IN (SELECT auction_id FROM watchlist WHERE user_id = $1) AND a.status <> 'removed'", [user.id],
      "(a.status = 'active') DESC, a.ends_at ASC, a.id", page, user.id);
  });
}
