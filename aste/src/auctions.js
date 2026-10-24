import { transaction } from './db.js';
import { AppError } from './errors.js';

// Un'offerta negli ultimi 2 minuti sposta la chiusura a 2 minuti da quel momento (anti-sniping).
export const ANTI_SNIPING_MS = 2 * 60 * 1000;
const MAX_AMOUNT = 100_000_000_00; // 100 milioni di euro, in centesimi
const MAX_DURATION_MIN = 30 * 24 * 60;

const isIntIn = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

export const minimumBid = (a) =>
  a.current_price == null ? a.starting_price : a.current_price + a.min_increment;

export function createAuction(db, sellerId, input, now = Date.now()) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const { startingPrice, minIncrement = 100, durationMinutes } = input;

  if (title.length < 3 || title.length > 120) throw new AppError(400, 'Il titolo deve avere 3-120 caratteri');
  if (description.length > 5000) throw new AppError(400, 'Descrizione troppo lunga (max 5000 caratteri)');
  if (!isIntIn(startingPrice, 1, MAX_AMOUNT)) throw new AppError(400, 'Prezzo di partenza non valido');
  if (!isIntIn(minIncrement, 1, MAX_AMOUNT)) throw new AppError(400, 'Rilancio minimo non valido');
  if (!isIntIn(durationMinutes, 1, MAX_DURATION_MIN)) throw new AppError(400, 'Durata non valida (1 minuto - 30 giorni)');

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO auctions (seller_id, title, description, starting_price, min_increment, created_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sellerId, title, description, startingPrice, minIncrement, now, now + durationMinutes * 60_000);
  return getAuction(db, Number(lastInsertRowid), now);
}

export function placeBid(db, auctionId, bidderId, amount, now = Date.now()) {
  return transaction(db, () => {
    const a = db.prepare('SELECT * FROM auctions WHERE id = ?').get(auctionId);
    if (!a) throw new AppError(404, 'Asta non trovata');
    if (now >= a.ends_at) throw new AppError(409, "L'asta è chiusa");
    if (a.seller_id === bidderId) throw new AppError(403, 'Non puoi fare offerte sulla tua asta');
    if (a.leader_id === bidderId) throw new AppError(409, 'Sei già il miglior offerente');

    const min = minimumBid(a);
    if (!isIntIn(amount, min, MAX_AMOUNT)) {
      throw new AppError(400, `L'offerta minima è ${formatEuro(min)}`);
    }

    const endsAt = a.ends_at - now < ANTI_SNIPING_MS ? now + ANTI_SNIPING_MS : a.ends_at;
    db.prepare('INSERT INTO bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)')
      .run(auctionId, bidderId, amount, now);
    db.prepare(`
      UPDATE auctions SET current_price = ?, leader_id = ?, bid_count = bid_count + 1, ends_at = ?
      WHERE id = ?`).run(amount, bidderId, endsAt, auctionId);
    return getAuction(db, auctionId, now);
  });
}

const AUCTION_SELECT = `
  SELECT a.*, s.username AS seller, l.username AS leader
  FROM auctions a
  JOIN users s ON s.id = a.seller_id
  LEFT JOIN users l ON l.id = a.leader_id`;

function toPublic(a, now) {
  const open = now < a.ends_at;
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    seller: a.seller,
    startingPrice: a.starting_price,
    minIncrement: a.min_increment,
    currentPrice: a.current_price,
    minimumBid: minimumBid(a),
    bidCount: a.bid_count,
    leader: a.leader,
    createdAt: a.created_at,
    endsAt: a.ends_at,
    status: open ? 'open' : 'closed',
    winner: open ? null : a.leader,
  };
}

export function getAuction(db, id, now = Date.now()) {
  const row = db.prepare(`${AUCTION_SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw new AppError(404, 'Asta non trovata');
  return toPublic(row, now);
}

export function listAuctions(db, { status = 'open', limit = 50 } = {}, now = Date.now()) {
  const rows = status === 'closed'
    ? db.prepare(`${AUCTION_SELECT} WHERE a.ends_at <= ? ORDER BY a.ends_at DESC LIMIT ?`).all(now, limit)
    : db.prepare(`${AUCTION_SELECT} WHERE a.ends_at > ? ORDER BY a.ends_at ASC LIMIT ?`).all(now, limit);
  return rows.map((r) => toPublic(r, now));
}

export function listBids(db, auctionId, limit = 20) {
  return db.prepare(`
    SELECT b.id, b.amount, b.created_at AS createdAt, u.username AS bidder
    FROM bids b JOIN users u ON u.id = b.bidder_id
    WHERE b.auction_id = ? ORDER BY b.id DESC LIMIT ?`).all(auctionId, limit)
    .map((b) => ({ ...b }));
}

export function formatEuro(cents) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
