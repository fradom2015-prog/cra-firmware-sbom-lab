import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { euro, isEndingSoon, timeLeft, AUCTION_STATUS } from '@/lib/format';
import type { Auction } from '@/lib/types';
import { radius, spacing, useColors } from '@/theme';
import { Badge, Text } from './ui';
import { useNow } from './useNow';

export function AuctionCard({ auction: a, wide }: { auction: Auction; wide?: boolean }) {
  const c = useColors();
  const now = useNow();
  const price = a.currentPrice ?? a.startingPrice;
  const open = a.status === 'active';
  const soon = open && isEndingSoon(a.endsAt, now);
  const label = `${a.title}, ${a.currentPrice != null ? 'offerta attuale' : 'base d\'asta'} ${euro(price)}, ${open ? `chiude tra ${timeLeft(a.endsAt, now)}` : AUCTION_STATUS[a.status]}`;

  return (
    <Link href={{ pathname: '/auction/[id]', params: { id: a.id } }} asChild>
      {/* Con Link asChild sul web lo stile arriva all'elemento <a>: serve un oggetto unico, non funzioni né array. */}
      <Pressable accessibilityRole="link" accessibilityLabel={label}
        style={StyleSheet.flatten([styles.card, wide ? styles.wide : styles.grid, { backgroundColor: c.surface, borderColor: c.border }])}>
        <Image source={a.images[0]?.url} style={[styles.image, wide && styles.wideImage, { backgroundColor: c.surfaceAlt }]} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        <View style={styles.body}>
          <Text numberOfLines={2} style={{ fontWeight: '500' }}>{a.title}</Text>
          <Text variant="price" style={{ fontSize: 18 }}>{euro(price)}</Text>
          <View style={styles.meta}>
            <Text variant="small">{a.bidCount === 1 ? '1 offerta' : `${a.bidCount} offerte`}</Text>
            {open ? (
              <Text variant="small" color={soon ? 'danger' : 'textMuted'} style={{ fontWeight: soon ? '700' : '400', fontVariant: ['tabular-nums'] }}>
                {timeLeft(a.endsAt, now)}
              </Text>
            ) : (
              <Badge label={AUCTION_STATUS[a.status]} tone={a.status === 'ended_sold' ? 'success' : 'neutral'} />
            )}
          </View>
          {a.viewer?.isLeader && open && <Badge label="Sei in testa" tone="success" />}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  // Griglia: colonne uguali; minWidth 0 evita che sul web un titolo lungo allarghi la colonna.
  grid: { flex: 1, flexBasis: 0, minWidth: 0 },
  // Elenco: riga con foto a sinistra, altezza data dal contenuto.
  wide: { flexDirection: 'row', minHeight: 120 },
  image: { width: '100%', aspectRatio: 1 },
  wideImage: { width: 112, aspectRatio: undefined, alignSelf: 'stretch' },
  body: { padding: spacing(3), gap: spacing(1), flex: 1 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing(2) },
});
