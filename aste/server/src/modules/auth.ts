import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { one, tx, type Queryable } from '../db/pool.js';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { audit, parse, requireUser, type AuthUser } from '../lib/http.js';
import { burnPasswordCheck, hashPassword, isPwnedPassword, verifyPassword } from '../services/password.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60 * 1000;

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const emailSchema = z.email('Email non valida').max(254).transform((e) => e.trim().toLowerCase());
export const passwordSchema = z.string()
  .min(10, 'La password deve avere almeno 10 caratteri')
  .max(128, 'La password può avere al massimo 128 caratteri');
export const displayNameSchema = z.string().trim()
  .regex(/^[a-zA-Z0-9_.-]{3,30}$/, 'Nome utente: 3-30 caratteri tra lettere, numeri, _ . -');

const registerBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  acceptTerms: z.literal(true, 'Devi accettare termini e condizioni'),
  confirmAdult: z.literal(true, 'Devi essere maggiorenne'),
});
const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const tokenBody = z.object({ token: z.string().min(10).max(200) });
const refreshBody = z.object({ refreshToken: z.string().min(10).max(200) });
const resetBody = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export async function checkNewPassword(app: FastifyInstance, password: string, email: string) {
  if (password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
    throw badRequest('weak_password', 'La password non può contenere il tuo indirizzo email');
  }
  if (app.deps.config.PWNED_PASSWORD_CHECK && (await isPwnedPassword(password))) {
    throw badRequest('pwned_password', 'Questa password compare in violazioni di dati note: scegline un\'altra');
  }
}

async function createSession(db: Queryable, userId: string, req: FastifyRequest, now: Date, familyId: string = randomUUID()) {
  const accessToken = randomToken('at');
  const refreshToken = randomToken('rt');
  await db.query(`
    INSERT INTO sessions (user_id, family_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, user_agent, ip, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [userId, familyId, sha256(accessToken), new Date(now.getTime() + ACCESS_TTL_MS), sha256(refreshToken),
    new Date(now.getTime() + REFRESH_TTL_MS), (req.headers['user-agent'] ?? '').slice(0, 300), req.ip, now]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
}

export async function issueEmailToken(db: Queryable, userId: string, purpose: 'verify_email' | 'reset_password', now: Date) {
  const token = randomToken(purpose === 'verify_email' ? 've' : 'pr');
  const ttl = purpose === 'verify_email' ? VERIFY_TTL_MS : RESET_TTL_MS;
  await db.query('UPDATE email_tokens SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose, now]);
  await db.query('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)',
    [sha256(token), userId, purpose, new Date(now.getTime() + ttl)]);
  return token;
}

async function consumeEmailToken(db: Queryable, token: string, purpose: string, now: Date) {
  const row = await one<{ user_id: string }>(db, `
    UPDATE email_tokens SET used_at = $3
    WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3
    RETURNING user_id`, [sha256(token), purpose, now]);
  if (!row) throw badRequest('invalid_token', 'Link non valido o scaduto');
  return row.user_id;
}

export async function revokeAllSessions(db: Queryable, userId: string, now: Date, exceptSessionId?: string) {
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $3',
    [userId, now, exceptSessionId ?? null]);
}

export async function authRoutes(app: FastifyInstance) {
  const { db, mailer, config } = app.deps;
  const now = () => app.deps.clock();

  async function sendVerification(userId: string, email: string) {
    const token = await issueEmailToken(db, userId, 'verify_email', now());
    await mailer.send({
      to: email,
      subject: 'Conferma il tuo indirizzo email',
      text: `Benvenuto! Conferma il tuo indirizzo aprendo questo link entro 24 ore:\n\n${config.PUBLIC_URL}/verify-email?token=${token}\n\nSe non hai creato tu l'account, ignora questo messaggio.`,
    });
  }

  // Risposta identica che l'email esista o no: non si può scoprire chi è registrato.
  app.post('/auth/register', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    await checkNewPassword(app, body.password, body.email);
    const existing = await one<{ id: string }>(db, 'SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing) {
      await mailer.send({
        to: body.email,
        subject: 'Hai già un account',
        text: `Qualcuno ha provato a registrarsi con questo indirizzo, che ha già un account.\nSe hai dimenticato la password puoi reimpostarla dall'app.`,
      });
      return reply.code(202).send({ status: 'check_email' });
    }
    if (await one(db, 'SELECT 1 FROM users WHERE display_name = $1', [body.displayName])) {
      throw conflict('display_name_taken', 'Nome utente già in uso');
    }
    const passwordHash = await hashPassword(body.password);
    const t = now();
    const user = await one<{ id: string }>(db, `
      INSERT INTO users (email, password_hash, display_name, terms_version, terms_accepted_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT DO NOTHING RETURNING id`,
    [body.email, passwordHash, body.displayName, config.TERMS_VERSION, t]);
    if (!user) throw conflict('display_name_taken', 'Nome utente già in uso');
    await audit(db, { userId: user.id, action: 'register', ip: req.ip }, t);
    await sendVerification(user.id, body.email);
    return reply.code(202).send({ status: 'check_email' });
  });

  app.post('/auth/login', { config: AUTH_RATE_LIMIT }, async (req) => {
    const body = parse(loginBody, req.body);
    const t = now();
    const user = await one<{ id: string; password_hash: string | null; status: string; failed_logins: number; locked_until: Date | null }>(db,
      'SELECT id, password_hash, status, failed_logins, locked_until FROM users WHERE email = $1', [body.email]);
    if (!user || !user.password_hash || user.status === 'deleted') {
      await burnPasswordCheck(body.password);
      throw unauthorized('Email o password non corretti');
    }
    if (user.locked_until && user.locked_until > t) {
      throw new AppError(429, 'account_locked', 'Troppi tentativi falliti: riprova tra qualche minuto');
    }
    if (!(await verifyPassword(user.password_hash, body.password))) {
      const failed = user.failed_logins + 1;
      await db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [
        user.id, failed >= MAX_FAILED_LOGINS ? 0 : failed, failed >= MAX_FAILED_LOGINS ? new Date(t.getTime() + LOCK_MS) : null]);
      await audit(db, { userId: user.id, action: 'login_failed', ip: req.ip }, t);
      throw unauthorized('Email o password non corretti');
    }
    if (user.status === 'suspended') throw new AppError(403, 'account_suspended', 'Account sospeso. Contatta l\'assistenza');
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    await audit(db, { userId: user.id, action: 'login', ip: req.ip }, t);
    return createSession(db, user.id, req, t);
  });

  app.post('/auth/refresh', { config: AUTH_RATE_LIMIT }, async (req) => {
    const { refreshToken } = parse(refreshBody, req.body);
    const t = now();
    const result = await tx(db, async (c) => {
      const s = await one<{ id: string; user_id: string; family_id: string; refresh_expires_at: Date; revoked_at: Date | null; status: string }>(c, `
        SELECT s.id, s.user_id, s.family_id, s.refresh_expires_at, s.revoked_at, u.status
        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = $1 FOR UPDATE OF s`, [sha256(refreshToken)]);
      if (!s) return null;
      if (s.revoked_at) {
        // Token già usato: probabilmente rubato. Chiudiamo tutta la catena di sessioni.
        await c.query('UPDATE sessions SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [s.family_id, t]);
        await audit(c, { userId: s.user_id, action: 'refresh_token_reuse', ip: req.ip }, t);
        return 'reuse' as const;
      }
      if (s.refresh_expires_at <= t || s.status !== 'active') return null;
      await c.query('UPDATE sessions SET rotated_at = $2, revoked_at = $2 WHERE id = $1', [s.id, t]);
      return createSession(c, s.user_id, req, t, s.family_id);
    });
    if (!result || result === 'reuse') throw unauthorized('Sessione scaduta, accedi di nuovo');
    return result;
  });

  app.post('/auth/logout', async (req, reply) => {
    const user = requireUser(req);
    await db.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [user.sessionId, now()]);
    return reply.code(204).send();
  });

  app.post('/auth/logout-all', async (req, reply) => {
    const user = requireUser(req);
    await revokeAllSessions(db, user.id, now());
    await audit(db, { userId: user.id, action: 'logout_all', ip: req.ip }, now());
    return reply.code(204).send();
  });

  app.post('/auth/verify-email', { config: AUTH_RATE_LIMIT }, async (req) => {
    const { token } = parse(tokenBody, req.body);
    const t = now();
    const userId = await consumeEmailToken(db, token, 'verify_email', t);
    await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1', [userId, t]);
    return { status: 'verified' };
  });

  app.post('/auth/resend-verification', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const user = requireUser(req);
    if (!user.emailVerified) await sendVerification(user.id, user.email);
    return reply.code(202).send({ status: 'check_email' });
  });

  app.post('/auth/forgot-password', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const user = await one<{ id: string }>(db, "SELECT id FROM users WHERE email = $1 AND status = 'active'", [email]);
    if (user) {
      const token = await issueEmailToken(db, user.id, 'reset_password', now());
      await mailer.send({
        to: email,
        subject: 'Reimposta la password',
        text: `Per scegliere una nuova password apri questo link entro un'ora:\n\n${config.PUBLIC_URL}/reset-password?token=${token}\n\nSe non l'hai chiesto tu, ignora questo messaggio: la password attuale resta valida.`,
      });
    }
    return reply.code(202).send({ status: 'check_email' });
  });

  app.post('/auth/reset-password', { config: AUTH_RATE_LIMIT }, async (req) => {
    const body = parse(resetBody, req.body);
    const t = now();
    const passwordHash = await hashPassword(body.password);
    await tx(db, async (c) => {
      const userId = await consumeEmailToken(c, body.token, 'reset_password', t);
      const u = await one<{ email: string }>(c, 'SELECT email FROM users WHERE id = $1', [userId]);
      await checkNewPassword(app, body.password, u!.email);
      // Chi riceve il link controlla la casella: l'email risulta verificata.
      await c.query(`UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL,
        email_verified_at = COALESCE(email_verified_at, $3) WHERE id = $1`, [userId, passwordHash, t]);
      await revokeAllSessions(c, userId, t);
      await audit(c, { userId, action: 'password_reset', ip: req.ip }, t);
    });
    return { status: 'password_changed' };
  });

  app.post('/auth/change-password', { config: AUTH_RATE_LIMIT }, async (req) => {
    const user = requireUser(req);
    const body = parse(changePasswordBody, req.body);
    const row = await one<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw badRequest('wrong_password', 'La password attuale non è corretta');
    }
    await checkNewPassword(app, body.newPassword, user.email);
    const t = now();
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(body.newPassword)]);
    await revokeAllSessions(db, user.id, t, user.sessionId);
    await audit(db, { userId: user.id, action: 'password_changed', ip: req.ip }, t);
    await mailer.send({ to: user.email, subject: 'Password modificata', text: 'La password del tuo account è stata cambiata. Se non sei stato tu, reimpostala subito e contatta l\'assistenza.' });
    return { status: 'password_changed' };
  });
}

// Legge "Authorization: Bearer <token>" e carica l'utente; le rotte decidono se è obbligatorio.
export async function loadUser(app: FastifyInstance, req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer at_')) return null;
  const row = await one<{ id: string; email: string; display_name: string; role: 'user' | 'admin'; email_verified_at: Date | null; session_id: string }>(app.deps.db, `
    SELECT u.id, u.email, u.display_name, u.role, u.email_verified_at, s.id AS session_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.access_hash = $1 AND s.access_expires_at > $2 AND s.revoked_at IS NULL AND u.status = 'active'`,
  [sha256(header.slice(7)), app.deps.clock()]);
  return row ? {
    id: row.id, email: row.email, displayName: row.display_name, role: row.role,
    emailVerified: row.email_verified_at != null, sessionId: row.session_id,
  } : null;
}
