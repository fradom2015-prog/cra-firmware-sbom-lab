import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
function TabIcon({ name, color, size }: { name: IconName; color: ColorValue; size: number }) {
  return <Ionicons name={name} color={color as string} size={size} />;
}

const icon = (name: IconName) => function Icon({ color, size }: { color: ColorValue; size: number }) {
  return <TabIcon name={name} color={color} size={size} />;
};

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.textMuted, headerShown: false, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border } }}>
      <Tabs.Screen name="index" options={{ title: 'Esplora', tabBarIcon: icon('compass-outline') }} />
      <Tabs.Screen name="search" options={{ title: 'Cerca', tabBarIcon: icon('search-outline') }} />
      <Tabs.Screen name="sell" options={{ title: 'Vendi', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="activity" options={{ title: 'Attività', tabBarIcon: icon('pulse-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profilo', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
