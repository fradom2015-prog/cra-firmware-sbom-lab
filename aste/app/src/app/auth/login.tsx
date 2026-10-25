import { useState } from 'react';
import { router } from 'expo-router';
import { Button, Field, Notice, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Accesso non riuscito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button title="Accedi" loading={busy} disabled={!email || !password} onPress={() => void submit()} />
      <Button title="Password dimenticata?" variant="ghost" onPress={() => router.push('/auth/forgot')} />
      <Button title="Non hai un account? Registrati" variant="ghost" onPress={() => router.replace('/auth/register')} />
    </Screen>
  );
}
