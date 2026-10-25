import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit, parse, requireAdmin, requireUser, requireVerified, uuidParam } from '../lib/http.js';
import { notifyUser } from '../services/notify.js';
import { revokeAllSessions } from './auth.js';

const REASONS = ['counterfeit', 'prohibited_item', 'fraud', 'offensive', 'spam', 'other'] as const;

const reportBody = z.object({
  targetType: z.enum(['auction', 'user']),
  targetId: z.uuid(),
  reason: z.enum(REASONS),
  details: z.string().trim().max(2000).default(''),
});

const resolveBody = z.object({
  action: z.enum(['dismiss', 'remove_auction', 'suspend_user']),
  // Motivazione comunicata all'interessato (DSA art. 17, "statement of reasons").
  statement: z.string().trim().min(10).max(2000),
});

export async function moderationRoutes(app: FastifyInstance) {
  const { db, bus } = app.deps;
  const now = () => app.deps.clock();

  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = requireVerified(req);
    const body = parse(reportBody, req.body);
    const exists = body.targetType === 'auction'
      ? await one(db, "SELECT 1 FROM auctions WHERE id = $1 AND status <> 'draft'", [body.targetId])
      : await one(db, "SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [body.targetId]);
    if (!exists) throw notFound('Contenuto non trovato');
    if (body.targetType === 'user' && body.targetId === user.id) throw badRequest('self_report', 'Non puoi segnalare te stesso');
    await db.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [user.id, body.targetType, body.targetId, body.reason, body.details, now()]);
    return reply.code(202).send({ status: 'received' });
  });

  app.get('/me/blocks', async (req) => {
    const user = requireUser(req);
    return { blocked: await many(db, `SELECT u.id, u.display_name AS "displayName" FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, [user.id]) };
  });

  // Un utente bloccato non può più fare offerte sulle aste di chi lo ha bloccato.
  app.put('/blocks/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    if (id === user.id) throw badRequest('self_block', 'Non puoi bloccare te stesso');
    if (!(await one(db, "SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [id]))) throw notFound('Utente non trovato');
    await db.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user.id, id, now()]);
    return reply.code(204).send();
  });

  app.delete('/blocks/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [user.id, id]);
    return reply.code(204).send();
  });

  app.get('/admin/reports', async (req) => {
    requireAdmin(req);
    const { status } = parse(z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open') }), req.query);
    return {
      reports: await many(db, `
        SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId", r.reason, r.details, r.status,
               r.resolution, r.created_at AS "createdAt", u.display_name AS reporter
        FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.status = $1 ORDER BY r.created_at LIMIT 200`, [status]),
    };
  });

  app.post('/admin/reports/:id/resolve', async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const body = parse(resolveBody, req.body);
    const t = now();
    const notices: { userId: string; subject: string; text: string }[] = [];
    const removed: string[] = [];

    await tx(db, async (c) => {
      const r = await one<{ target_type: string; target_id: string; status: string }>(c, 'SELECT target_type, target_id, status FROM reports WHERE id = $1 FOR UPDATE', [id]);
      if (!r) throw notFound('Segnalazione non trovata');
      if (r.status !== 'open') throw conflict('already_resolved', 'Segnalazione già gestita');

      if (body.action === 'remove_auction') {
        if (r.target_type !== 'auction') throw badRequest('wrong_target', 'La segnalazione non riguarda un\'asta');
        const a = await one<{ id: string; seller_id: string; title: string; leader_id: string | null }>(c,
          "UPDATE auctions SET status = 'removed', closed_at = $2, updated_at = $2 WHERE id = $1 AND status IN ('active', 'draft', 'ended_unsold') RETURNING id, seller_id, title, leader_id",
          [r.target_id, t]);
        if (a) {
          removed.push(a.id);
          notices.push({ userId: a.seller_id, subject: `Annuncio rimosso: ${a.title}`, text: `Il tuo annuncio "${a.title}" è stato rimosso.\n\nMotivazione: ${body.statement}\n\nPuoi contestare la decisione rispondendo a questa email.` });
          if (a.leader_id) notices.push({ userId: a.leader_id, subject: `Asta annullata: ${a.title}`, text: `L'asta "${a.title}" su cui eri in testa è stata rimossa dalla moderazione. Nessun addebito è stato effettuato.` });
        }
      } else if (body.action === 'suspend_user') {
        const userId = r.target_type === 'user'
          ? r.target_id
          : (await one<{ seller_id: string }>(c, 'SELECT seller_id FROM auctions WHERE id = $1', [r.target_id]))?.seller_id;
        if (!userId) throw notFound('Utente non trovato');
        await c.query("UPDATE users SET status = 'suspended' WHERE id = $1 AND status = 'active'", [userId]);
        await revokeAllSessions(c, userId, t);
        const auctions = await many<{ id: string }>(c, "UPDATE auctions SET status = 'removed', closed_at = $2, updated_at = $2 WHERE seller_id = $1 AND status = 'active' RETURNING id", [userId, t]);
        removed.push(...auctions.map((x) => x.id));
        notices.push({ userId, subject: 'Account sospeso', text: `Il tuo account è stato sospeso.\n\nMotivazione: ${body.statement}\n\nPuoi contestare la decisione rispondendo a questa email.` });
      }

      // Tutte le segnalazioni aperte sullo stesso contenuto si chiudono insieme.
      await c.query(`UPDATE reports SET status = $3, resolution = $4, resolved_by = $5, resolved_at = $6
        WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
      [r.target_type, r.target_id, body.action === 'dismiss' ? 'dismissed' : 'actioned', `${body.action}: ${body.statement}`, admin.id, t]);
      await audit(c, { userId: admin.id, action: `moderation_${body.action}`, ip: req.ip, meta: { reportId: id, target: r.target_id } }, t);
    });

    for (const auctionId of removed) await bus.publish(`auction:${auctionId}`, { type: 'removed', auctionId });
    for (const n of notices) await notifyUser(app, n.userId, { subject: n.subject, text: n.text });
    return { status: 'resolved' };
  });
}
