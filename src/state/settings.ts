import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCalendars, getLocales } from 'expo-localization';
import { DEFAULT_STEAM_REGIONS, DEFAULT_SWITCH_REGIONS, guessHome, withNewRegions } from '@shared/regions';
import { persistStorage } from './storage';

export type ThemePref = 'system' | 'dark' | 'light';

export interface Settings {
  homeRegion: string;
  homeCurrency: string;
  /** Switch eShops the user can actually buy from. "Best price" only considers these. */
  switchRegions: string[];
  steamRegions: string[];
  /** The user turned alerts on (and granted permission) */
  alertsEnabled: boolean;
  /** Asked once, at the first watch. Never nag again. */
  alertsPrompted: boolean;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
  theme: ThemePref;
  /** Store-wide sale alerts */
  eventStoreSales: boolean;
  /** Big deals on popular games */
  eventBigDeals: boolean;
  eventPlatforms: ('switch2' | 'switch' | 'steam')[];
  eventMinDiscount: number;
  /** Your Gamely server, e.g. http://192.168.1.20:8787. Empty uses the build's default. */
  serverUrl: string;
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  toggleSwitchRegion: (code: string) => void;
  toggleSteamRegion: (code: string) => void;
}

function initialHome() {
  try {
    const l = getLocales()[0];
    return guessHome(l?.regionCode, l?.currencyCode);
  } catch {
    return guessHome();
  }
}

export function deviceTimeZone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
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
        alertsPrompted: false,
        quietHours: true,
        quietStart: 22,
        quietEnd: 8,
        theme: 'system',
        eventStoreSales: true,
        eventBigDeals: true,
        eventPlatforms: ['switch2', 'switch', 'steam'],
        eventMinDiscount: 50,
        serverUrl: '',
        set: (patch) => set(patch),
        toggleSwitchRegion: (code) => set((s) => ({ switchRegions: toggle(s.switchRegions, code) })),
        toggleSteamRegion: (code) => set((s) => ({ steamRegions: toggle(s.steamRegions, code) })),
      };
    },
    {
      name: 'gamely.settings',
      storage: persistStorage,
      version: 5,
      migrate: (old, version) => {
        const s = {
          alertsPrompted: false,
          quietHours: true,
          quietStart: 22,
          quietEnd: 8,
          eventStoreSales: true,
          eventBigDeals: true,
          eventPlatforms: ['switch2', 'switch', 'steam'],
          eventMinDiscount: 50,
          serverUrl: '',
          ...(old as object),
        } as SettingsState;
        // Version 5 added Hong Kong and South Korea
        if (version < 5 && Array.isArray(s.switchRegions)) s.switchRegions = withNewRegions(s.switchRegions);
        return s;
      },
    },
  ),
);
