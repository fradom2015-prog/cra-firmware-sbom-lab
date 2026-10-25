import type { ExpoConfig } from 'expo/config';

// Identificativi provvisori: da sostituire con quelli definitivi prima della prima build.
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'it.asteonline.app';
const API_HOST = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/^https?:\/\//, '');

const config: ExpoConfig = {
  name: 'Aste',
  slug: 'aste',
  scheme: 'aste',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    // Universal link: i link nelle email (verifica, reset, aste) aprono l'app. Il server, che serve
    // anche la web app sullo stesso dominio, pubblica /.well-known/apple-app-site-association.
    associatedDomains: [`applinks:${API_HOST}`],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
      ],
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#C2410C',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Niente backup automatico su Google Drive dei dati dell'app (contengono la sessione).
    allowBackup: false,
    permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'],
    intentFilters: [{
      action: 'VIEW',
      autoVerify: true,
      data: ['/verify-email', '/reset-password', '/auction/'].map((pathPrefix) => ({ scheme: 'https', host: API_HOST, pathPrefix })),
      category: ['BROWSABLE', 'DEFAULT'],
    }],
  },
  web: { favicon: './assets/favicon.png', output: 'single', bundler: 'metro' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', {
      image: './assets/splash-icon.png',
      imageWidth: 160,
      resizeMode: 'contain',
      backgroundColor: '#F7F7F5',
      dark: { image: './assets/splash-icon.png', backgroundColor: '#111317' },
    }],
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-image',
    'expo-web-browser',
    'expo-localization',
    ['expo-image-picker', {
      photosPermission: 'Aste usa le tue foto solo per gli annunci che pubblichi.',
      cameraPermission: 'Aste usa la fotocamera per fotografare gli oggetti che vendi.',
      microphonePermission: false,
    }],
    ['expo-notifications', { color: '#C2410C' }],
    ['@stripe/stripe-react-native', {
      merchantIdentifier: process.env.APPLE_MERCHANT_ID ?? `merchant.${BUNDLE_ID}`,
      enableGooglePay: true,
    }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
