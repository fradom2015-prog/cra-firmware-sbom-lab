import { View } from 'react-native';
import type { Auction } from '@/lib/types';
import { spacing } from '@/theme';
import { AuctionCard } from './AuctionCard';

// Griglia a due colonne senza FlatList annidate (le pagine scorrono già).
export function AuctionGrid({ auctions }: { auctions: Auction[] }) {
  const rows: Auction[][] = [];
  for (let i = 0; i < auctions.length; i += 2) rows.push(auctions.slice(i, i + 2));
  return (
    <View style={{ gap: spacing(3) }}>
      {rows.map((row) => (
        <View key={row[0]!.id} style={{ flexDirection: 'row', gap: spacing(3) }}>
          {row.map((a) => <AuctionCard key={a.id} auction={a} />)}
          {row.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}
