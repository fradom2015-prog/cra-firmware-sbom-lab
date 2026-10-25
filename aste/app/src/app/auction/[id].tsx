import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Text } from '@/components/ui';
import { useNow } from '@/components/useNow';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { feeOf, suggestedBids } from '@/lib/bidding';
import { confirm, inform } from '@/lib/dialog';
import { AUCTION_STATUS, centsToInput, CONDITIONS, dateTime, euro, isEndingSoon, parseEuro, timeLeft } from '@/lib/format';
import { keys, useAuction, useMeta } from '@/lib/queries';
import type { Auction } from '@/lib/types';
import { radius, spacing, useColors } from '@/theme';

export default function AuctionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error, refetch, bids } = useAuction(id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const c = useColors();

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const a = data.auction;

  const toggleWatch = async () => {
    if (!user) return router.push('/auth/login');
    await api(`/auctions/${a.id}/watch`, { method: data.watching ? 'DELETE' : 'PUT' }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: keys.auction(a.id) });
    void qc.invalidateQueries({ queryKey: ['me', 'watchlist'] });
  };

  return (
    <>
      <Stack.Screen options={{
        headerRight: () => (
          <Row style={{ gap: spacing(4) }}>
            {!a.viewer?.isSeller && (
              <Pressable onPress={toggleWatch} accessibilityRole="button" accessibilityLabel={data.watching ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'} hitSlop={10}>
                <Ionicons name={data.watching ? 'heart' : 'heart-outline'} size={24} color={c.accent} />
              </Pressable>
            )}
            {user && !a.viewer?.isSeller && (
              <Pressable onPress={() => router.push({ pathname: '/report', params: { type: 'auction', id: a.id } })} accessibilityRole="button" accessibilityLabel="Segnala annuncio" hitSlop={10}>
                <Ionicons name="flag-outline" size={22} color={c.textMuted} />
              </Pressable>
            )}
          </Row>
        ),
      }} />
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: spacing(12) }} keyboardShouldPersistTaps="handled">
        <Gallery auction={a} />
        <View style={{ padding: spacing(4), gap: spacing(4) }}>
          <View style={{ gap: spacing(2) }}>
            <Row style={{ flexWrap: 'wrap' }}>
              <Badge label={a.category.name} />
              <Badge label={CONDITIONS[a.condition]} />
              {a.status !== 'active' && <Badge label={AUCTION_STATUS[a.status]} tone={a.status === 'ended_sold' ? 'success' : 'neutral'} />}
            </Row>
            <Text variant="title" accessibilityRole="header">{a.title}</Text>
          </View>

          <PriceCard auction={a} />
          <BidPanel auction={a} />
          <SellerActions auction={a} />

          <Card>
            <Text variant="heading">Venditore</Text>
            <Link href={{ pathname: '/user/[id]', params: { id: a.seller.id } }} asChild>
              <Pressable accessibilityRole="link">
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ gap: 2 }}>
                    <Text style={{ fontWeight: '600' }}>{a.seller.displayName}</Text>
                    <Text variant="small">{a.seller.type === 'business' ? 'Venditore professionale' : 'Venditore privato'}</Text>
                  </View>
                  <Text variant="muted">›</Text>
                </Row>
              </Pressable>
            </Link>
            <Text variant="small">
              {a.seller.type === 'business'
                ? 'Acquisti da un professionista: hai diritto di recesso entro 14 giorni e alla garanzia legale di 2 anni.'
                : 'Acquisti da un privato: non si applicano recesso e garanzia legale del Codice del Consumo. Sei comunque coperto dal pagamento protetto.'}
            </Text>
          </Card>

          {!!a.description && (
            <View style={{ gap: spacing(2) }}>
              <Text variant="heading">Descrizione</Text>
              <Text selectable>{a.description}</Text>
            </View>
          )}

          <Card>
            <Row><Ionicons name="shield-checkmark-outline" size={22} color={c.success} /><Text variant="heading">Pagamento protetto</Text></Row>
            <Text variant="muted">
              Paghi nell&apos;app e il venditore riceve i soldi solo dopo che confermi la consegna. Se l&apos;oggetto non arriva o non corrisponde alla descrizione, apri una contestazione e ti rimborsiamo.
            </Text>
            <Text variant="small">Spedizione: {a.shippingPrice ? euro(a.shippingPrice) : 'gratuita'}</Text>
          </Card>

          <View style={{ gap: spacing(2) }}>
            <Text variant="heading">Offerte ({a.bidCount})</Text>
            {bids.data?.length ? bids.data.slice(0, 15).map((b) => (
              <Row key={b.id} style={{ justifyContent: 'space-between', paddingVertical: spacing(1.5) }}>
                <Text style={{ fontWeight: b.isMine ? '700' : '400' }}>
                  {b.isMine ? 'Tu' : b.bidder}{b.isAuto ? ' (automatica)' : ''}
                </Text>
                <Row>
                  <Text variant="small">{dateTime(b.createdAt)}</Text>
                  <Text style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>{euro(b.amount)}</Text>
                </Row>
              </Row>
            )) : <Text variant="muted">Ancora nessuna offerta: puoi essere il primo.</Text>}
          </View>
        </View>
      </ScrollView>
    </>
  );
}

function Gallery({ auction }: { auction: Auction }) {
  const c = useColors();
  const [page, setPage] = useState(0);
  const width = Math.min(Dimensions.get('window').width, 700);
  if (!auction.images.length) return <View style={{ width, height: width * 0.75, backgroundColor: c.surfaceAlt }} />;
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {auction.images.map((img, i) => (
          <Image key={img.id} source={img.url} style={{ width, height: width * 0.8, backgroundColor: c.surfaceAlt }} contentFit="contain"
            accessibilityLabel={`Foto ${i + 1} di ${auction.images.length}`} />
        ))}
      </ScrollView>
      {auction.images.length > 1 && (
        <View style={styles.dots}>
          {auction.images.map((img, i) => <View key={img.id} style={[styles.dot, { backgroundColor: i === page ? c.accent : c.border }]} />)}
        </View>
      )}
    </View>
  );
}

function PriceCard({ auction: a }: { auction: Auction }) {
  const now = useNow();
  const open = a.status === 'active';
  const soon = open && isEndingSoon(a.endsAt, now);
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 2 }}>
          <Text variant="small">{a.currentPrice == null ? 'Base d\'asta' : open ? 'Offerta attuale' : 'Prezzo finale'}</Text>
          <Text variant="price" style={{ fontSize: 30 }} accessibilityLiveRegion="polite">{euro(a.currentPrice ?? a.startingPrice)}</Text>
          <Text variant="small">{a.bidCount === 1 ? '1 offerta' : `${a.bidCount} offerte`}{a.leader ? ` · in testa ${a.viewer?.isLeader ? 'tu' : a.leader}` : ''}</Text>
        </View>
        {open && (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text variant="small">Chiude tra</Text>
            <Text variant="heading" color={soon ? 'danger' : 'text'} style={{ fontVariant: ['tabular-nums'] }}>{timeLeft(a.endsAt, now)}</Text>
            {a.endsAt && <Text variant="small">{dateTime(a.endsAt)}</Text>}
          </View>
        )}
      </Row>
      {a.hasReserve && (
        <Badge label={a.reserveMet ? 'Prezzo di riserva raggiunto' : 'Prezzo di riserva non ancora raggiunto'} tone={a.reserveMet ? 'success' : 'warning'} />
      )}
      {a.viewer?.isLeader && open && (
        <Notice tone="success">Sei in testa. La tua offerta massima è {euro(a.viewer.maxBid!)}: rilanciamo per te fino a questo importo.</Notice>
      )}
    </Card>
  );
}

function BidPanel({ auction: a }: { auction: Auction }) {
  const { user, status } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (a.status !== 'active' || a.minimumBid == null) {
    if (a.status === 'ended_sold' && a.viewer?.isLeader) {
      return <Notice tone="success" action={<Button title="Vai ai tuoi acquisti" onPress={() => router.push({ pathname: '/activity', params: { tab: 'purchases' } })} />}>Hai vinto questa asta!</Notice>;
    }
    return null;
  }
  if (a.viewer?.isSeller) return null;
  if (status !== 'signedIn') return <Button title="Accedi per fare un'offerta" onPress={() => router.push('/auth/login')} />;
  if (!user?.emailVerified) return <Notice tone="warning">Conferma il tuo indirizzo email per fare offerte.</Notice>;

  const isLeader = a.viewer?.isLeader;
  const minimum = isLeader ? Math.max(a.minimumBid, (a.viewer?.maxBid ?? 0) + 100) : a.minimumBid;

  const submit = async (amount: number | null) => {
    setError(null);
    if (amount == null) return setError('Inserisci un importo valido, ad esempio 25,50');
    if (amount < minimum) return setError(`L'offerta minima è ${euro(minimum)}`);
    const fee = meta.data ? feeOf(amount, meta.data.buyerFeeBps) : 0;
    const ok = await confirm(
      `Offerta massima ${euro(amount)}`,
      `Rilanciamo automaticamente per te, del minimo necessario, fino a questo importo.\n\nSe vinci al massimo pagherai: ${euro(amount)} + spedizione ${euro(a.shippingPrice)}${fee ? ` + protezione acquisti ${euro(fee)}` : ''}.\n\nL'offerta è vincolante.`,
      'Offri',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ auction: Auction; outbid: boolean }>(`/auctions/${a.id}/bids`, {
        body: { maxAmount: amount, idempotencyKey: Crypto.randomUUID() },
      });
      qc.setQueryData(keys.auction(a.id), (old: { auction: Auction; watching: boolean } | undefined) => old && { ...old, auction: res.auction });
      void qc.invalidateQueries({ queryKey: keys.bids(a.id) });
      void qc.invalidateQueries({ queryKey: ['me', 'bidding'] });
      setText('');
      if (res.outbid) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        inform('Sei stato superato', `Un altro offerente aveva già impostato un massimo più alto. Offerta attuale: ${euro(res.auction.currentPrice!)}.`);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Offerta non riuscita, riprova.');
      void qc.invalidateQueries({ queryKey: keys.auction(a.id) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="heading">{isLeader ? 'Alza la tua offerta massima' : 'Fai un\'offerta'}</Text>
      {!isLeader && (
        <Row style={{ flexWrap: 'wrap' }}>
          {suggestedBids(minimum).map((v) => <Chip key={v} label={euro(v)} onPress={() => void submit(v)} />)}
        </Row>
      )}
      <Field
        label="La tua offerta massima (€)"
        value={text}
        onChangeText={(t) => { setText(t); setError(null); }}
        placeholder={centsToInput(minimum)}
        keyboardType="decimal-pad"
        error={error}
        hint={`Minimo ${euro(minimum)}. Nessuno vede il tuo massimo.`}
        onSubmitEditing={() => void submit(parseEuro(text))}
      />
      <Button title="Offri" loading={busy} onPress={() => void submit(parseEuro(text))} />
    </Card>
  );
}

function SellerActions({ auction: a }: { auction: Auction }) {
  const qc = useQueryClient();
  if (!a.viewer?.isSeller) return null;
  if (a.status === 'draft') {
    return <Button title="Completa e pubblica la bozza" onPress={() => router.push({ pathname: '/sell/new', params: { id: a.id } })} />;
  }
  if (a.status === 'active' && a.bidCount === 0) {
    return (
      <Button title="Ritira l'asta" variant="secondary" onPress={async () => {
        if (!(await confirm('Ritirare l\'asta?', 'L\'annuncio non sarà più visibile. Puoi farlo solo finché non ci sono offerte.', 'Ritira', true))) return;
        try {
          await api(`/auctions/${a.id}/cancel`, { method: 'POST' });
          void qc.invalidateQueries({ queryKey: keys.auction(a.id) });
        } catch (e) {
          inform('Impossibile ritirare', e instanceof Error ? e.message : undefined);
        }
      }} />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: spacing(2) },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
});
