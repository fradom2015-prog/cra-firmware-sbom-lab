import * as SecureStore from 'expo-secure-store';

// iOS Keychain / Android Keystore. "THIS_DEVICE_ONLY": il token non viaggia nei backup
// né su un telefono nuovo, dove l'utente dovrà accedere di nuovo.
const KEY = 'aste.refreshToken';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY, OPTIONS),
  set: (token: string) => SecureStore.setItemAsync(KEY, token, OPTIONS),
  clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
};
