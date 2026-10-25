import type { FastifyInstance } from 'fastify';
import { one } from '../db/pool.js';

export interface Notice {
  subject: string;
  text: string;
  data?: Record<string, string>;
}

// Avvisa un utente: email ed evento in tempo reale sul suo canale privato
// (nella fase app si aggiungono le notifiche push). Mai bloccante per chi la chiama.
export async function notifyUser(app: FastifyInstance, userId: string, notice: Notice) {
  try {
    const user = await one<{ email: string; status: string }>(app.deps.db, 'SELECT email, status FROM users WHERE id = $1', [userId]);
    if (!user || user.status === 'deleted') return;
    await app.deps.bus.publish(`user:${userId}`, { type: 'notification', subject: notice.subject, data: notice.data ?? {} });
    await app.deps.mailer.send({ to: user.email, subject: notice.subject, text: notice.text });
  } catch (err) {
    app.log.error({ err, userId }, 'notifica non inviata');
  }
}
