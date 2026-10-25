import { useState } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { PaymentsProvider } from '@/lib/payments';
import { useNotificationRouting } from '@/lib/push';
import { useColors } from '@/theme';

function Navigation() {
  const c = useColors();
  const scheme = useColorScheme();
  useNotificationRouting();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.surface, text: c.text, border: c.border } }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: c.accent, headerTitleStyle: { color: c.text } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auction/[id]" options={{ title: '' }} />
        <Stack.Screen name="sell/new" options={{ title: 'Nuova asta' }} />
        <Stack.Screen name="sell/seller-profile" options={{ title: 'Profilo venditore' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Ordine' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Profilo' }} />
        <Stack.Screen name="auth/login" options={{ title: 'Accedi', presentation: 'modal' }} />
        <Stack.Screen name="auth/register" options={{ title: 'Crea account', presentation: 'modal' }} />
        <Stack.Screen name="auth/forgot" options={{ title: 'Password dimenticata', presentation: 'modal' }} />
        <Stack.Screen name="report" options={{ title: 'Segnala', presentation: 'modal' }} />
        <Stack.Screen name="verify-email" options={{ title: 'Verifica email' }} />
        <Stack.Screen name="reset-password" options={{ title: 'Nuova password' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Impostazioni' }} />
        <Stack.Screen name="settings/blocked" options={{ title: 'Utenti bloccati' }} />
        <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Gli errori del client (4xx) non si ritentano: non cambierebbe nulla.
        retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  }));
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PaymentsProvider>
            <Navigation />
          </PaymentsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
