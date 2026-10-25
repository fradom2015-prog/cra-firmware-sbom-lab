import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuctionGrid } from '@/components/AuctionGrid';
import { Chip, Empty, ErrorState, Loading, Notice, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAuctionSearch, useCategories } from '@/lib/queries';
import { spacing, useColors } from '@/theme';

export default function Home() {
  const c = useColors();
  const { user } = useAuth();
  const categories = useCategories();
  const ending = useAuctionSearch({ sort: 'ending_soon' });
  const newest = useAuctionSearch({ sort: 'newest' });
  const endingItems = ending.data?.pages[0]?.items.slice(0, 6) ?? [];
  const newestItems = newest.data?.pages[0]?.items.slice(0, 6) ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing(4), gap: spacing(5), paddingBottom: spacing(10) }}
        refreshControl={<RefreshControl refreshing={ending.isRefetching} onRefresh={() => { void ending.refetch(); void newest.refetch(); }} />}
      >
        <View style={{ gap: spacing(1) }}>
          <Text variant="title" accessibilityRole="header">Aste</Text>
          <Text variant="muted">Oggetti unici, offerte protette.</Text>
        </View>

        {user && !user.emailVerified && (
          <Notice tone="warning">Conferma il tuo indirizzo email per fare offerte: ti abbiamo mandato un link.</Notice>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(2) }} accessibilityLabel="Categorie">
          {categories.data?.map((cat) => (
            <Chip key={cat.slug} label={cat.name} onPress={() => router.push({ pathname: '/search', params: { category: cat.slug } })} />
          ))}
        </ScrollView>

        {ending.isLoading ? <Loading /> : ending.error ? <ErrorState error={ending.error} onRetry={() => void ending.refetch()} /> : endingItems.length === 0 ? (
          <Empty title="Nessuna asta in corso" message="Sii il primo: metti in vendita qualcosa dalla scheda Vendi." />
        ) : (
          <>
            <View style={{ gap: spacing(3) }}>
              <Text variant="heading" accessibilityRole="header">In chiusura</Text>
              <AuctionGrid auctions={endingItems} />
            </View>
            {newestItems.length > 0 && (
              <View style={{ gap: spacing(3) }}>
                <Text variant="heading" accessibilityRole="header">Nuovi arrivi</Text>
                <AuctionGrid auctions={newestItems} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
