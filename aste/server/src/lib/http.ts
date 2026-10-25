import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden, unauthorized } from './errors.js';
import type { Queryable } from '../db/pool.js';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  sessionId: string;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw new AppError(400, 'validation', field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Dati non validi'));
  }
  return result.data;
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

// Offrire, vendere e pagare richiedono un'email verificata.
export function requireVerified(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (!user.emailVerified) throw forbidden('email_not_verified', "Verifica prima il tuo indirizzo email");
  return user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden('forbidden', 'Operazione riservata agli amministratori');
  return user;
}

export async function audit(db: Queryable, entry: { userId?: string | null; action: string; ip?: string | null; meta?: object }, now: Date) {
  await db.query('INSERT INTO audit_log (user_id, action, ip, meta, created_at) VALUES ($1, $2, $3, $4, $5)',
    [entry.userId ?? null, entry.action, entry.ip ?? null, entry.meta ?? {}, now]);
}

export const uuidParam = z.object({ id: z.uuid() });
