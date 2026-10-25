import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { api } from './api';

let currentToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Chiede il permesso e registra il dispositivo sul server. Silenzioso se non disponibile.
export async function registerForPush() {
  try {
    if (!Device.isDevice) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Aste', importance: AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    currentToken = data;
    await api('/me/push-tokens', { method: 'PUT', body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  } catch {
    // Le notifiche sono un di più: l'app funziona anche senza.
  }
}

export async function unregisterPush() {
  if (currentToken) await api(`/me/push-tokens/${encodeURIComponent(currentToken)}`, { method: 'DELETE' });
  currentToken = null;
}

// Tocco su una notifica: apre l'asta o l'ordine.
export function routeFromNotification(data: Record<string, unknown> | undefined) {
  if (typeof data?.orderId === 'string') router.push({ pathname: '/order/[id]', params: { id: data.orderId } });
  else if (typeof data?.auctionId === 'string') router.push({ pathname: '/auction/[id]', params: { id: data.auctionId } });
}

export function useNotificationRouting() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (last && last.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      routeFromNotification(last.notification.request.content.data);
    }
  }, [last]);
}
