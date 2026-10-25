import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuctionCard } from '@/components/AuctionCard';
import { Button, Empty, ErrorState, Loading, Notice, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyList } from '@/lib/queries';
import { spacing, useColors } from '@/theme';

export default function Sell() {
  const c = useColors();
  const { user, status } = useAuth();
  const mine = useMyList('auctions', status === 'signedIn');

  if (status !== 'signedIn') {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
        <Empty title="Vendi all'asta" message="Accedi per mettere in vendita i tuoi oggetti. Paghi solo una commissione quando vendi."
          action={<Button title="Accedi" onPress={() => router.push('/auth/login')} />} />
      </SafeAreaView>
    );
  }

  const ready = user?.seller?.payoutsEnabled;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing(4), gap: spacing(4), paddingBottom: spacing(10) }}
        refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()} />}>
        <Text variant="title" accessibilityRole="header">Vendi</Text>
        {!user?.emailVerified ? (
          <Notice tone="warning">Conferma il tuo indirizzo email per iniziare a vendere.</Notice>
        ) : !ready && (
          <Notice tone="accent" action={<Button title={user?.seller ? 'Completa la verifica' : 'Diventa venditore'} onPress={() => router.push('/sell/seller-profile')} />}>
            Per pubblicare serve il profilo venditore e la verifica per ricevere gli incassi (gestita da Stripe, richiede pochi minuti).
          </Notice>
        )}
        <Button title="Nuova asta" onPress={() => router.push('/sell/new')} disabled={!user?.emailVerified} />
        <Text variant="heading">Le tue aste</Text>
        {mine.isLoading ? <Loading /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> :
          !mine.data?.items.length ? <Empty title="Nessuna asta" message="Le aste che crei compariranno qui." /> : (
            <View style={{ gap: spacing(3) }}>
              {mine.data.items.map((a) => <AuctionCard key={a.id} auction={a} wide />)}
            </View>
          )}
      </ScrollView>
    </SafeAreaView>
  );
}
