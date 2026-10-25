// Notifiche push tramite il servizio Expo (inoltra ad APNs per iOS e FCM per Android).
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSender {
  /** Invia i messaggi e restituisce i token non più validi, da eliminare. */
  send(messages: PushMessage[]): Promise<string[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function createExpoPushSender(accessToken?: string): PushSender {
  return {
    async send(messages) {
      const invalid: string[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default' }))),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Expo push: HTTP ${res.status}`);
        const { data } = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
        data.forEach((ticket, j) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalid.push(chunk[j]!.to);
        });
      }
      return invalid;
    },
  };
}

// Per sviluppo e test: conserva i messaggi.
export class MemoryPushSender implements PushSender {
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
    return [];
  }
}
