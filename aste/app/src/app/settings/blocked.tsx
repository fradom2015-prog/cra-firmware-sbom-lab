import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, ErrorState, ListItem, Loading, Screen, Text } from '@/components/ui';
import { api } from '@/lib/api';

export default function Blocked() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocks'], queryFn: () => api<{ blocked: { id: string; displayName: string }[] }>('/me/blocks').then((r) => r.blocked) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Screen edges={[]}>
      <Text variant="muted">Gli utenti bloccati non possono fare offerte sulle tue aste.</Text>
      {!q.data?.length ? <Empty title="Nessun utente bloccato" /> : q.data.map((u) => (
        <ListItem key={u.id} title={u.displayName} right={<Button title="Sblocca" variant="ghost" onPress={async () => {
          await api(`/blocks/${u.id}`, { method: 'DELETE' });
          void qc.invalidateQueries({ queryKey: ['blocks'] });
        }} />} />
      ))}
    </Screen>
  );
}
