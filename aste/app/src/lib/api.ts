import { Platform } from 'react-native';
import { API_URL } from './config';
import { tokenStore } from './tokenStore';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshing: Promise<boolean> | null = null;
const expiredListeners = new Set<() => void>();

export const onSessionExpired = (fn: () => void) => {
  expiredListeners.add(fn);
  return () => void expiredListeners.delete(fn);
};

export const hasAccessToken = () => accessToken != null;
export const getAccessToken = () => accessToken;

export async function saveSession(tokens: Tokens) {
  accessToken = tokens.accessToken;
  accessExpiresAt = Date.now() + (tokens.expiresIn - 30) * 1000;
  await tokenStore.set(tokens.refreshToken);
}

export async function clearSession() {
  accessToken = null;
  accessExpiresAt = 0;
  await tokenStore.clear();
}

// Una sola richiesta di rinnovo alla volta: il server ruota il refresh token e
// considera un furto il riuso di quello vecchio.
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await tokenStore.get();
      if (!refreshToken) return false;
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401) {
        await clearSession();
        expiredListeners.forEach((fn) => fn());
        return false;
      }
      if (!res.ok) return false; // errore temporaneo: la sessione resta
      await saveSession(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Ripristino della sessione all'avvio, una sola volta. Le richieste partite prima
// (schermata aperta da un link o da una notifica) lo attendono invece di uscire con 401.
let initializing: Promise<boolean> | null = null;
export const initSession = () => (initializing ??= refreshSession());

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  if (!accessToken && !path.startsWith('/auth/')) await initSession();
  if (accessToken && Date.now() > accessExpiresAt) await refreshSession();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'network', 'Connessione assente. Controlla la rete e riprova.');
  }

  if (res.status === 401 && accessToken && !retried && (await refreshSession())) {
    return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'Si è verificato un errore, riprova.');
  }
  return data as T;
}

// Foto dal selettore: sul telefono si invia l'URI del file, sul web il blob.
export async function uploadImage(auctionId: string, uri: string, mimeType = 'image/jpeg') {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, 'foto.jpg');
  } else {
    form.append('file', { uri, name: 'foto.jpg', type: mimeType } as unknown as Blob);
  }
  return api<{ image: { id: string; url: string } }>(`/auctions/${auctionId}/images`, { form });
}
