import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Empty, Notice, Screen, Text } from '@/components/ui';
import { LEGAL } from '@/content/legal';
import { spacing } from '@/theme';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = LEGAL[doc];
  if (!d) return <Screen><Empty title="Documento non trovato" /></Screen>;
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: d.title }} />
      <Text variant="small">{d.updated}</Text>
      {d.updated.includes('bozza') && <Notice tone="warning">Bozza in revisione legale: il testo definitivo sarà pubblicato prima del lancio.</Notice>}
      {d.sections.map((s) => (
        <View key={s.heading} style={{ gap: spacing(1.5) }}>
          <Text variant="heading" accessibilityRole="header">{s.heading}</Text>
          <Text selectable>{s.body}</Text>
        </View>
      ))}
    </Screen>
  );
}
