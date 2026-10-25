export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/v1/ws`;
export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
export const SUPPORT_EMAIL = 'assistenza@example.com';
