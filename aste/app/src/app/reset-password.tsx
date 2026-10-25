import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { forget } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <Screen edges={[]}>
        <Notice tone="success">Password aggiornata. Per sicurezza abbiamo chiuso le sessioni aperte su tutti i dispositivi.</Notice>
        <Button title="Accedi" onPress={() => router.replace('/auth/login')} />
      </Screen>
    );
  }
  return (
    <Screen edges={[]}>
      <Field label="Nuova password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="Almeno 10 caratteri." error={error} />
      <Button title="Salva password" loading={busy} disabled={!token || password.length < 10} onPress={async () => {
        setBusy(true);
        try {
          await api('/auth/reset-password', { body: { token, password } });
          await forget();
          setDone(true);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Operazione non riuscita');
        } finally {
          setBusy(false);
        }
      }} />
    </Screen>
  );
}
