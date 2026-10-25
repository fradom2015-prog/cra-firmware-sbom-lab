import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';

// Bus degli eventi in tempo reale. Con Redis gli eventi raggiungono tutte le istanze del server.
export interface EventBus {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(handler: (channel: string, payload: unknown) => void): () => void;
  close(): Promise<void>;
}

const PREFIX = 'aste:';

export function createLocalBus(): EventBus {
  const em = new EventEmitter();
  em.setMaxListeners(0);
  return {
    publish: async (channel, payload) => void em.emit('msg', channel, payload),
    subscribe: (handler) => {
      em.on('msg', handler);
      return () => em.off('msg', handler);
    },
    close: async () => void em.removeAllListeners(),
  };
}

export function createRedisBus(url: string): EventBus {
  const pub = new Redis(url);
  const sub = new Redis(url);
  const local = createLocalBus();
  void sub.psubscribe(`${PREFIX}*`);
  sub.on('pmessage', (_pattern, channel, message) => {
    void local.publish(channel.slice(PREFIX.length), JSON.parse(message));
  });
  return {
    publish: async (channel, payload) => void (await pub.publish(PREFIX + channel, JSON.stringify(payload))),
    subscribe: local.subscribe,
    close: async () => {
      await Promise.all([pub.quit(), sub.quit()]);
    },
  };
}
