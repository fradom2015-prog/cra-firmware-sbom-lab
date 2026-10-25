import { useState } from 'react';
import { Button, Field, Notice, Screen, Text } from '@/components/ui';
import { api } from '@/lib/api';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (sent) return <Screen edges={[]}><Notice tone="success">Se esiste un account con questo indirizzo, riceverai un link per scegliere una nuova password. Il link vale un&apos;ora.</Notice></Screen>;
  return (
    <Screen edges={[]}>
      <Text variant="muted">Inserisci l&apos;email del tuo account: ti invieremo un link per reimpostare la password.</Text>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Button title="Invia link" loading={busy} disabled={!email.includes('@')} onPress={async () => {
        setBusy(true);
        await api('/auth/forgot-password', { body: { email: email.trim() } }).catch(() => undefined);
        setSent(true);
        setBusy(false);
      }} />
    </Screen>
  );
}
