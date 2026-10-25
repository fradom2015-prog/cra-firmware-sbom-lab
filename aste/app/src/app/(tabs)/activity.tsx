import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuctionCard } from '@/components/AuctionCard';
import { Badge, Button, Card, Empty, ErrorState, Loading, Row, Segmented, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { dateTime, euro, ORDER_STATUS } from '@/lib/format';
import { useMyList, useOrders } from '@/lib/queries';
import type { Order } from '@/lib/types';
import { spacing, useColors } from '@/theme';

type Tab = 'bidding' | 'watchlist' | 'purchases' | 'sales';

export default function Activity() {
  const c = useColors();
  const { status } = useAuth();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  // Se si arriva con ?tab=... (es. "Vai ai tuoi acquisti") quella scheda prevale.
  const [state, setState] = useState<{ param?: Tab; tab: Tab }>({ param: params.tab, tab: params.tab ?? 'bidding' });
  if (state.param !== params.tab) setState({ param: params.tab, tab: params.tab ?? state.tab });
  const tab = state.tab;
  const setTab = (t: Tab) => setState((s) => ({ ...s, tab: t }));
  const signedIn = status === 'signedIn';

  const bidding = useMyList('bidding', signedIn && tab === 'bidding');
  const watchlist = useMyList('watchlist', signedIn && tab === 'watchlist');
  const purchases = useOrders('buyer', signedIn && tab === 'purchases');
  const sales = useOrders('seller', signedIn && tab === 'sales');

  if (!signedIn) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
        <Empty title="Le tue attività" message="Accedi per seguire offerte, preferiti e ordini." action={<Button title="Accedi" onPress={() => router.push('/auth/login')} />} />
      </SafeAreaView>
    );
  }

  const current = { bidding, watchlist, purchases, sales }[tab];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing(4), gap: spacing(4), paddingBottom: spacing(10) }}
        refreshControl={<RefreshControl refreshing={current.isRefetching} onRefresh={() => void current.refetch()} />}>
        <Text variant="title" accessibilityRole="header">Attività</Text>
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'bidding', label: 'Offerte' }, { value: 'watchlist', label: 'Preferiti' },
          { value: 'purchases', label: 'Acquisti' }, { value: 'sales', label: 'Vendite' },
        ]} />
        {current.isLoading ? <Loading /> : current.error ? <ErrorState error={current.error} onRetry={() => void current.refetch()} /> : (
          tab === 'bidding' || tab === 'watchlist' ? (
            (tab === 'bidding' ? bidding : watchlist).data?.items.length ? (
              <View style={{ gap: spacing(3) }}>
                {(tab === 'bidding' ? bidding : watchlist).data!.items.map((a) => <AuctionCard key={a.id} auction={a} wide />)}
              </View>
            ) : <Empty title={tab === 'bidding' ? 'Nessuna offerta' : 'Nessun preferito'} message={tab === 'bidding' ? 'Le aste su cui offri compariranno qui.' : 'Tocca il cuore su un\'asta per seguirla.'} />
          ) : (
            (tab === 'purchases' ? purchases : sales).data?.length ? (
              <View style={{ gap: spacing(3) }}>{(tab === 'purchases' ? purchases : sales).data!.map((o) => <OrderRow key={o.id} order={o} />)}</View>
            ) : <Empty title={tab === 'purchases' ? 'Nessun acquisto' : 'Nessuna vendita'} message="Gli ordini delle aste concluse compariranno qui." />
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const TONE: Record<Order['status'], 'warning' | 'accent' | 'success' | 'danger' | 'neutral'> = {
  awaiting_payment: 'warning', paid: 'accent', shipped: 'accent', disputed: 'danger', completed: 'success', cancelled: 'neutral', refunded: 'neutral',
};

function OrderRow({ order: o }: { order: Order }) {
  const needsAction = (o.role === 'buyer' && (o.status === 'awaiting_payment' || o.status === 'shipped')) || (o.role === 'seller' && o.status === 'paid');
  return (
    <Pressable onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })} accessibilityRole="button">
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Badge label={ORDER_STATUS[o.status]} tone={TONE[o.status]} />
          {needsAction && <Badge label="Azione richiesta" tone="accent" />}
        </Row>
        <Text numberOfLines={2} style={{ fontWeight: '600' }}>{o.title}</Text>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="small">{o.role === 'buyer' ? `Venditore: ${o.seller}` : `Acquirente: ${o.buyer}`} · {dateTime(o.createdAt)}</Text>
          <Text style={{ fontWeight: '700' }}>{euro(o.role === 'buyer' ? o.totalAmount! : o.payout!)}</Text>
        </Row>
      </Card>
    </Pressable>
  );
}
