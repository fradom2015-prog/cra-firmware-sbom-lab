import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { AppError } from './errors.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Nel database finisce solo l'hash del token: chi legge il DB non può impersonare gli utenti.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Hash fittizio per rendere simile il tempo di risposta con utente esistente o inesistente.
const DUMMY_HASH = hashPassword('dummy-password');

export function register(db, { username, password }, now = Date.now()) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new AppError(400, 'Nome utente: 3-30 caratteri tra lettere, numeri, _ . -');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new AppError(400, 'La password deve avere almeno 8 caratteri');
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new AppError(409, 'Nome utente già in uso');
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), now);
  return { id: Number(lastInsertRowid), username };
}

export function login(db, { username, password }) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new AppError(400, 'Credenziali mancanti');
  }
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'Credenziali non valide');
  return { id: user.id, username: user.username };
}

export function createSession(db, userId, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, now + SESSION_TTL_MS);
  return { token, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export function userFromSession(db, token, now = Date.now()) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), now);
  return row ? { id: row.id, username: row.username } : null;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
