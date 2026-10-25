import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EFEC',
  text: '#1B1D22',
  textMuted: '#646B76',
  border: '#E3E2DE',
  accent: '#C2410C',
  accentText: '#FFFFFF',
  accentSoft: '#FDEBDD',
  success: '#15803D',
  successSoft: '#DCF5E3',
  danger: '#B42318',
  dangerSoft: '#FDE4E1',
  warning: '#A15C07',
  warningSoft: '#FDF1D8',
};

const dark: typeof light = {
  bg: '#111317',
  surface: '#1B1E24',
  surfaceAlt: '#252932',
  text: '#ECEDEF',
  textMuted: '#9CA3AF',
  border: '#2E333D',
  accent: '#F97316',
  accentText: '#1A0F05',
  accentSoft: '#3A2112',
  success: '#4ADE80',
  successSoft: '#13301F',
  danger: '#F87171',
  dangerSoft: '#3B1717',
  warning: '#FBBF24',
  warningSoft: '#3A2A0C',
};

export type Colors = typeof light;
export const spacing = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
