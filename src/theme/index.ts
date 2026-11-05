import { useColorScheme } from 'react-native';
import type { Platform } from '../domain/types';
import { useSettings } from '../state/settings';

const dark = {
  bg: '#0E1013',
  surface: '#171A1F',
  surface2: '#20242B',
  border: '#2A2F38',
  text: '#F2F4F7',
  textDim: '#9AA3AF',
  textFaint: '#6B7280',
  accent: '#7C9CFF',
  good: '#3DDC97',
  goodBg: 'rgba(61,220,151,0.14)',
  warn: '#FFB547',
  warnBg: 'rgba(255,181,71,0.14)',
  bad: '#FF6B6B',
  overlay: 'rgba(0,0,0,0.55)',
  skeleton: '#1F232A',
};

const light: typeof dark = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  surface2: '#EEF0F3',
  border: '#E1E4E9',
  text: '#0F1115',
  textDim: '#525B67',
  textFaint: '#8A93A0',
  accent: '#3D5AFE',
  good: '#0E9F6E',
  goodBg: 'rgba(14,159,110,0.12)',
  warn: '#B76E00',
  warnBg: 'rgba(183,110,0,0.12)',
  bad: '#D93636',
  overlay: 'rgba(0,0,0,0.35)',
  skeleton: '#E7E9ED',
};

export type Colors = typeof dark;

export const platformMeta: Record<Platform, { label: string; short: string; color: string }> = {
  switch2: { label: 'Switch 2', short: 'NS2', color: '#FF5470' },
  switch: { label: 'Switch', short: 'NS1', color: '#FF8A3D' },
  steam: { label: 'Steam', short: 'PC', color: '#5AA9E6' },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export function useTheme(): { c: Colors; dark: boolean } {
  const pref = useSettings((s) => s.theme);
  const system = useColorScheme();
  const isDark = pref === 'system' ? system !== 'light' : pref === 'dark';
  return { c: isDark ? dark : light, dark: isDark };
}
