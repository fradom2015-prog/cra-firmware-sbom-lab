import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Chip, Field, Notice, Row, Screen, Text } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const REASONS = [
  { value: 'counterfeit', label: 'Contraffatto' },
  { value: 'prohibited_item', label: 'Oggetto vietato' },
  { value: 'fraud', label: 'Truffa' },
  { value: 'offensive', label: 'Offensivo' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Altro' },
];

export default function Report() {
  const { type, id } = useLocalSearchParams<{ type: 'auction' | 'user'; id: string }>();
  const [reason, setReason] = useState<string>();
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen edges={[]}>
        <Notice tone="success">Grazie, la segnalazione è stata inviata. Il nostro team la esaminerà; se interveniamo, informiamo l&apos;interessato con la motivazione.</Notice>
        <Button title="Chiudi" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <Screen edges={[]}>
      <Text variant="muted">{type === 'user' ? 'Perché segnali questo utente?' : 'Cosa non va in questo annuncio?'}</Text>
      <Row style={{ flexWrap: 'wrap' }}>{REASONS.map((r) => <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />)}</Row>
      <Field label="Dettagli (facoltativo)" value={details} onChangeText={setDetails} multiline maxLength={2000} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button title="Invia segnalazione" disabled={!reason} onPress={async () => {
        try {
          await api('/reports', { body: { targetType: type, targetId: id, reason, details } });
          setSent(true);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Invio non riuscito');
        }
      }} />
    </Screen>
  );
}
