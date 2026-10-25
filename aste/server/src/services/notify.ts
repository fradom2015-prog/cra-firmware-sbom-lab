import type { FastifyInstance } from 'fastify';
import { many, one } from '../db/pool.js';

export interface Notice {
  subject: string;
  text: string;
  data?: Record<string, string>;
}

// Avvisa un utente: evento in tempo reale, notifica push sui suoi dispositivi ed email.
// Mai bloccante per chi la chiama.
export async function notifyUser(app: FastifyInstance, userId: string, notice: Notice) {
  try {
    const user = await one<{ email: string; status: string }>(app.deps.db, 'SELECT email, status FROM users WHERE id = $1', [userId]);
    if (!user || user.status === 'deleted') return;
    await app.deps.bus.publish(`user:${userId}`, { type: 'notification', subject: notice.subject, data: notice.data ?? {} });
    const tokens = await many<{ token: string }>(app.deps.db, 'SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
    if (tokens.length) {
      // Nella push solo la prima riga del testo: niente dati sensibili sulla schermata di blocco.
      const body = notice.text.split('\n')[0]!.slice(0, 180);
      try {
        const invalid = await app.deps.push.send(tokens.map((t) => ({ to: t.token, title: notice.subject, body, data: notice.data ?? {} })));
        if (invalid.length) await app.deps.db.query('DELETE FROM push_tokens WHERE token = ANY($1)', [invalid]);
      } catch (err) {
        app.log.warn({ err, userId }, 'push non inviata');
      }
    }
    await app.deps.mailer.send({ to: user.email, subject: notice.subject, text: notice.text });
  } catch (err) {
    app.log.error({ err, userId }, 'notifica non inviata');
  }
}
