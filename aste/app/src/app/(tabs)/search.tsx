import { useEffect, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuctionCard } from '@/components/AuctionCard';
import { Chip, Empty, ErrorState, Field, Loading, Text } from '@/components/ui';
import { useAuctionSearch, useCategories } from '@/lib/queries';
import { spacing, useColors } from '@/theme';

const SORTS = [
  { value: 'ending_soon', label: 'In chiusura' },
  { value: 'newest', label: 'Più recenti' },
  { value: 'price_asc', label: 'Prezzo ↑' },
  { value: 'price_desc', label: 'Prezzo ↓' },
];

export default function Search() {
  const c = useColors();
  const params = useLocalSearchParams<{ category?: string }>();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<{ param?: string; value?: string }>({ param: params.category, value: params.category });
  if (cat.param !== params.category) setCat({ param: params.category, value: params.category });
  const category = cat.value;
  const setCategory = (value?: string) => setCat((s) => ({ ...s, value }));
  const [sort, setSort] = useState<string | undefined>();
  const categories = useCategories();

  // Ricerca dopo una breve pausa nella digitazione.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const search = useAuctionSearch({ q: q || undefined, category, sort });
  const items = search.data?.pages.flatMap((p) => p.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <AuctionCard auction={item} wide />}
        contentContainerStyle={{ padding: spacing(4), gap: spacing(3), paddingBottom: spacing(10) }}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && void search.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ gap: spacing(3), marginBottom: spacing(1) }}>
            <Text variant="title" accessibilityRole="header">Cerca</Text>
            <Field label="Cosa cerchi?" value={text} onChangeText={setText} placeholder="Es. Leica, Rolex, Tex Willer" returnKeyType="search" autoCorrect={false} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(2) }}>
              <Chip label="Tutte" selected={!category} onPress={() => setCategory(undefined)} />
              {categories.data?.map((cat) => (
                <Chip key={cat.slug} label={cat.name} selected={category === cat.slug} onPress={() => setCategory(category === cat.slug ? undefined : cat.slug)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(2) }}>
              {SORTS.map((s) => <Chip key={s.value} label={s.label} selected={sort === s.value} onPress={() => setSort(sort === s.value ? undefined : s.value)} />)}
            </ScrollView>
            {!search.isLoading && <Text variant="small" accessibilityLiveRegion="polite">{total === 1 ? '1 risultato' : `${total} risultati`}</Text>}
          </View>
        }
        ListEmptyComponent={search.isLoading ? <Loading /> : search.error ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : (
          <Empty title="Nessun risultato" message="Prova con parole diverse o un'altra categoria." />
        )}
        ListFooterComponent={search.isFetchingNextPage ? <Loading /> : undefined}
      />
    </SafeAreaView>
  );
}
