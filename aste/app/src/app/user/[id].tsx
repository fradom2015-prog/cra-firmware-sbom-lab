import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Loading, Row, Screen, Text } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, inform } from '@/lib/dialog';
import { dateOnly } from '@/lib/format';
import { usePublicUser } from '@/lib/queries';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useAuth();
  const q = usePublicUser(id);
  const qc = useQueryClient();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const u = q.data;
  const isMe = me?.id === u.id;

  return (
    <Screen edges={[]}>
      <Text variant="title">{u.displayName}</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        {u.sellerType && <Badge label={u.sellerType === 'business' ? 'Venditore professionale' : 'Venditore privato'} tone="accent" />}
        {u.suspended && <Badge label="Account sospeso" tone="danger" />}
      </Row>
      <Text variant="muted">
        Su Aste dal {dateOnly(u.memberSince)} · {u.completedSales} vendite concluse
        {u.rating ? ` · ★ ${u.rating.average.toLocaleString('it-IT')} (${u.rating.count})` : ''}
      </Text>

      {u.business && (
        <Card>
          <Text variant="heading">Dati del venditore</Text>
          <Text selectable>{u.business.legalName}{'\n'}P. IVA {u.business.vatNumber}{'\n'}{u.business.address}{'\n'}{u.business.email} · {u.business.phone}</Text>
        </Card>
      )}

      <Text variant="heading">Recensioni</Text>
      {u.reviews.length ? u.reviews.map((r, i) => (
        <Card key={i}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text color="accent">{'★'.repeat(r.rating)}<Text color="border">{'★'.repeat(5 - r.rating)}</Text></Text>
            <Text variant="small">{r.reviewer} · {dateOnly(r.createdAt)}</Text>
          </Row>
          {!!r.comment && <Text>{r.comment}</Text>}
        </Card>
      )) : <Text variant="muted">Ancora nessuna recensione.</Text>}

      {me && !isMe && (
        <>
          <Button title="Segnala utente" variant="secondary" onPress={() => router.push({ pathname: '/report', params: { type: 'user', id: u.id } })} />
          <Button title="Blocca utente" variant="ghost" onPress={async () => {
            if (!(await confirm(`Bloccare ${u.displayName}?`, 'Non potrà più fare offerte sulle tue aste. Puoi sbloccarlo dalle impostazioni.', 'Blocca', true))) return;
            await api(`/blocks/${u.id}`, { method: 'PUT' });
            void qc.invalidateQueries({ queryKey: ['blocks'] });
            inform('Utente bloccato');
          }} />
        </>
      )}
    </Screen>
  );
}
