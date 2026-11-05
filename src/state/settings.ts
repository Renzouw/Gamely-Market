import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getLocales } from 'expo-localization';
import { DEFAULT_STEAM_REGIONS, DEFAULT_SWITCH_REGIONS, guessHome } from '../domain/regions';
import { persistStorage } from './storage';

export type ThemePref = 'system' | 'dark' | 'light';

export interface SettingsState {
  homeRegion: string;
  homeCurrency: string;
  /** Switch eShops the user can actually buy from. "Best price" only considers these. */
  switchRegions: string[];
  steamRegions: string[];
  alertsEnabled: boolean;
  theme: ThemePref;
  onboarded: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'toggleSwitchRegion' | 'toggleSteamRegion'>>) => void;
  toggleSwitchRegion: (code: string) => void;
  toggleSteamRegion: (code: string) => void;
}

function initialHome() {
  try {
    const locale = getLocales()[0];
    return guessHome(locale?.regionCode, locale?.currencyCode);
  } catch {
    return guessHome();
  }
}

const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

export const useSettings = create<SettingsState>()(
  persist(
    (set) => {
      const home = initialHome();
      return {
        homeRegion: home.region,
        homeCurrency: home.currency,
        switchRegions: DEFAULT_SWITCH_REGIONS,
        steamRegions: DEFAULT_STEAM_REGIONS,
        alertsEnabled: false,
        theme: 'system',
        onboarded: false,
        set: (patch) => set(patch),
        toggleSwitchRegion: (code) => set((s) => ({ switchRegions: toggle(s.switchRegions, code) })),
        toggleSteamRegion: (code) => set((s) => ({ steamRegions: toggle(s.steamRegions, code) })),
      };
    },
    { name: 'gamely.settings', storage: persistStorage, version: 1 },
  ),
);

