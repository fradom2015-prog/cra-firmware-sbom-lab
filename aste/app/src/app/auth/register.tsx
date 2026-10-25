import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Field, Notice, Row, Screen, Text } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useColors } from '@/theme';

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? c.accent : c.textMuted} />
        <View style={{ flex: 1 }}>{children}</View>
      </Row>
    </Pressable>
  );
}

export default function Register() {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', { body: { email: email.trim(), displayName: displayName.trim(), password, acceptTerms: terms, confirmAdult: adult } });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registrazione non riuscita');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen edges={[]}>
        <Notice tone="success">Ti abbiamo inviato un&apos;email a {email.trim()}. Apri il link per confermare l&apos;indirizzo, poi accedi.</Notice>
        <Button title="Vai all'accesso" onPress={() => router.replace('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Nome utente" value={displayName} onChangeText={setDisplayName} autoCapitalize="none" autoComplete="username" hint="Visibile agli altri. 3-30 caratteri: lettere, numeri, _ . -" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="Almeno 10 caratteri. Meglio una frase facile da ricordare." />
      <Check checked={terms} onToggle={() => setTerms(!terms)}>
        <Text variant="muted">
          Accetto i <Text variant="muted" color="accent" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'termini' } })}>Termini e condizioni</Text> e
          ho letto l&apos;<Text variant="muted" color="accent" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}>Informativa privacy</Text>.
        </Text>
      </Check>
      <Check checked={adult} onToggle={() => setAdult(!adult)}>
        <Text variant="muted">Ho almeno 18 anni.</Text>
      </Check>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button title="Crea account" loading={busy} disabled={!email || !displayName || password.length < 10 || !terms || !adult} onPress={() => void submit()} />
    </Screen>
  );
}
