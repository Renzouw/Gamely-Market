import { useColorScheme } from 'react-native';
import type { Platform } from '@shared/types';
import { useSettings } from '../state/settings';

/**
 * Warm ink and paper neutrals with one signal colour. Lime means "this is
 * the price to pay attention to" and is used for nothing else. Interactive
 * elements are plain ink, so the signal never competes with chrome.
 */
const dark = {
  bg: '#0F0F0E',
  surface: '#181816',
  raised: '#22221F',
  line: '#2D2C29',
  text: '#F4F2EC',
  muted: '#A9A59B',
  subtle: '#8A867C',
  signal: '#C8F04A',
  signalText: '#C8F04A',
  signalInk: '#151A02',
  signalWash: 'rgba(200,240,74,0.12)',
  warn: '#FFB547',
  warnWash: 'rgba(255,181,71,0.12)',
  danger: '#FF7A6B',
  scrim: 'rgba(15,15,14,0.0)',
  scrimEnd: '#0F0F0E',
  skeleton: '#1F1F1C',
  invert: '#F4F2EC',
  invertText: '#0F0F0E',
};

const light: typeof dark = {
  bg: '#F5F3EE',
  surface: '#FFFFFF',
  raised: '#ECE9E2',
  line: '#E0DCD3',
  text: '#141412',
  muted: '#55524B',
  subtle: '#6E6A62',
  signal: '#C8F04A',
  signalText: '#3F6B00',
  signalInk: '#151A02',
  signalWash: 'rgba(120,170,0,0.14)',
  warn: '#9A5B00',
  warnWash: 'rgba(200,120,0,0.12)',
  danger: '#C2321F',
  scrim: 'rgba(245,243,238,0.0)',
  scrimEnd: '#F5F3EE',
  skeleton: '#E7E4DD',
  invert: '#141412',
  invertText: '#F5F3EE',
};

export type Colors = typeof dark;

export const platformMeta: Record<Platform, { label: string; dot: string }> = {
  switch2: { label: 'Switch 2', dot: '#FF5C3A' },
  switch: { label: 'Switch', dot: '#F0A202' },
  steam: { label: 'Steam', dot: '#4FA3E0' },
};

export const font = {
  regular: 'Schibsted-Regular',
  medium: 'Schibsted-Medium',
  semibold: 'Schibsted-SemiBold',
  bold: 'Schibsted-Bold',
  mono: 'Plex-Regular',
  monoMedium: 'Plex-Medium',
  monoSemibold: 'Plex-SemiBold',
};

/** 4pt grid */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };
/** Minimum touch target */
export const HIT = 44;
export const GUTTER = space.lg;

export function useTheme(): { c: Colors; dark: boolean } {
  const pref = useSettings((s) => s.theme);
  const system = useColorScheme();
  const isDark = pref === 'system' ? system !== 'light' : pref === 'dark';
  return { c: isDark ? dark : light, dark: isDark };
}
