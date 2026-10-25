import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, clearSession, hasAccessToken, initSession, onSessionExpired, saveSession } from './api';
import { realtime } from './realtime';
import { registerForPush, unregisterPush } from './push';
import type { Me } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: Me | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reloadUser(): Promise<void>;
  /** Dopo eliminazione account o reset password: pulisce senza chiamare il server. */
  forget(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const queryClient = useQueryClient();

  const signedOut = useCallback(() => {
    setUser(null);
    setStatus('signedOut');
    queryClient.clear();
    realtime.reset();
  }, [queryClient]);

  const reloadUser = useCallback(async () => {
    const { user: me } = await api<{ user: Me }>('/me');
    setUser(me);
    setStatus('signedIn');
  }, []);

  useEffect(() => {
    // All'avvio: il refresh token salvato riapre la sessione.
    (async () => {
      if (await initSession()) {
        try {
          await reloadUser();
          void registerForPush();
          return;
        } catch {
          /* sessione non valida */
        }
      }
      setStatus('signedOut');
    })();
    return onSessionExpired(signedOut);
  }, [reloadUser, signedOut]);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api<{ accessToken: string; refreshToken: string; expiresIn: number }>('/auth/login', { body: { email, password } });
    await saveSession(tokens);
    queryClient.clear();
    await reloadUser();
    realtime.reset();
    void registerForPush();
  }, [queryClient, reloadUser]);

  const forget = useCallback(async () => {
    await clearSession();
    signedOut();
  }, [signedOut]);

  const logout = useCallback(async () => {
    await unregisterPush().catch(() => undefined);
    if (hasAccessToken()) await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await forget();
  }, [forget]);

  const value = useMemo(() => ({ status, user, login, logout, reloadUser, forget }), [status, user, login, logout, reloadUser, forget]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuori da AuthProvider');
  return ctx;
}
