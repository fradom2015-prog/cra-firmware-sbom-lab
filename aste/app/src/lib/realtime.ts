import { WS_URL } from './config';
import { getAccessToken } from './api';
import type { Auction } from './types';

type Listener = (msg: { type: string; auction?: Auction; auctionId?: string; status?: string }) => void;

// Una sola connessione WebSocket per tutta l'app, con riconnessione progressiva.
class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private userListeners = new Set<(msg: { subject: string; data: Record<string, string> }) => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private connect() {
    if (this.ws || this.timer) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const token = getAccessToken();
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
      for (const id of this.listeners.keys()) ws.send(JSON.stringify({ type: 'subscribe', auctionId: id }));
    };
    ws.onmessage = (e) => {
      let msg: { channel?: string; type: string; subject?: string; data?: Record<string, string> };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.channel?.startsWith('auction:')) {
        this.listeners.get(msg.channel.slice(8))?.forEach((fn) => fn(msg as Parameters<Listener>[0]));
      } else if (msg.channel?.startsWith('user:') && msg.type === 'notification') {
        this.userListeners.forEach((fn) => fn({ subject: msg.subject ?? '', data: msg.data ?? {} }));
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.listeners.size === 0 && this.userListeners.size === 0) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.connect();
      }, delay);
    };
  }

  subscribeAuction(id: string, fn: Listener) {
    const set = this.listeners.get(id) ?? new Set();
    const isNew = set.size === 0;
    set.add(fn);
    this.listeners.set(id, set);
    this.connect();
    if (isNew && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', auctionId: id }));
    return () => {
      set.delete(fn);
      if (set.size === 0) {
        this.listeners.delete(id);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'unsubscribe', auctionId: id }));
      }
    };
  }

  onUserNotification(fn: (msg: { subject: string; data: Record<string, string> }) => void) {
    this.userListeners.add(fn);
    this.connect();
    return () => void this.userListeners.delete(fn);
  }

  // Dopo login o logout: si riconnette con le nuove credenziali.
  reset() {
    this.ws?.close();
  }
}

export const realtime = new Realtime();
