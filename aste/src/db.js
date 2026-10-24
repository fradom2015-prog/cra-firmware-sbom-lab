import { DatabaseSync } from 'node:sqlite';

// Gli importi sono sempre interi in centesimi, gli istanti in millisecondi epoch.
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id             INTEGER PRIMARY KEY,
  seller_id      INTEGER NOT NULL REFERENCES users(id),
  title          TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  starting_price INTEGER NOT NULL CHECK (starting_price > 0),
  min_increment  INTEGER NOT NULL CHECK (min_increment > 0),
  current_price  INTEGER,
  leader_id      INTEGER REFERENCES users(id),
  bid_count      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id         INTEGER PRIMARY KEY,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  bidder_id  INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bids_by_auction ON bids(auction_id, id DESC);
CREATE INDEX IF NOT EXISTS auctions_by_end ON auctions(ends_at);
`;

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Esegue fn in una transazione; BEGIN IMMEDIATE prende subito il lock in scrittura,
// così due offerte concorrenti (anche da processi diversi) non leggono lo stesso prezzo.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
