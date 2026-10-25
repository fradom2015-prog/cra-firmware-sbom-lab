import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { loadUser } from './auth.js';

// WebSocket per gli aggiornamenti in tempo reale (supportato nativamente da iOS, Android e web).
// Il client si iscrive alle aste che sta guardando; dopo "auth" riceve anche i propri avvisi.
const MAX_SUBSCRIPTIONS = 50;

const message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), auctionId: z.uuid() }),
  z.object({ type: z.literal('unsubscribe'), auctionId: z.uuid() }),
  z.object({ type: z.literal('auth'), token: z.string().max(200) }),
]);

export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    const channels = new Set<string>();
    let alive = true;

    const unsubscribe = app.deps.bus.subscribe((channel, payload) => {
      if (channels.has(channel) && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ channel, ...(payload as object) }));
      }
    });

    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('pong', () => (alive = true));

    socket.on('message', async (raw) => {
      let msg: z.infer<typeof message>;
      try {
        const data = raw.toString();
        if (data.length > 1000) throw new Error();
        msg = message.parse(JSON.parse(data));
      } catch {
        return socket.send(JSON.stringify({ type: 'error', error: 'Messaggio non valido' }));
      }
      if (msg.type === 'subscribe') {
        if (channels.size >= MAX_SUBSCRIPTIONS) return socket.send(JSON.stringify({ type: 'error', error: 'Troppe iscrizioni' }));
        channels.add(`auction:${msg.auctionId}`);
      } else if (msg.type === 'unsubscribe') {
        channels.delete(`auction:${msg.auctionId}`);
      } else {
        const fakeReq = { headers: { authorization: `Bearer ${msg.token}` } } as Parameters<typeof loadUser>[1];
        const user = await loadUser(app, fakeReq);
        if (!user) return socket.send(JSON.stringify({ type: 'error', error: 'Token non valido' }));
        for (const ch of channels) if (ch.startsWith('user:')) channels.delete(ch);
        channels.add(`user:${user.id}`);
        socket.send(JSON.stringify({ type: 'authenticated' }));
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
