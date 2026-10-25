import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Aperta dal link nell'email (universal link / app link, o sito web).
export default function VerifyEmail() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { status, reloadUser } = useAuth();
  const [state, setState] = useState<'loading' | 'ok' | string>(token ? 'loading' : 'Link non valido');

  useEffect(() => {
    if (!token) return;
    api('/auth/verify-email', { body: { token } })
      .then(() => setState('ok'))
      .catch((e) => setState(e instanceof ApiError ? e.message : 'Verifica non riuscita'));
  }, [token]);

  useEffect(() => {
    if (state === 'ok' && status === 'signedIn') void reloadUser();
  }, [state, status, reloadUser]);

  if (state === 'loading') return <Loading />;
  return (
    <Screen edges={[]}>
      {state === 'ok' ? <Notice tone="success">Indirizzo email confermato. Ora puoi fare offerte e vendere.</Notice> : <Notice tone="danger">{state}</Notice>}
      <Button title={status === 'signedIn' ? 'Vai alle aste' : 'Accedi'} onPress={() => router.replace(status === 'signedIn' ? '/' : '/auth/login')} />
    </Screen>
  );
}
