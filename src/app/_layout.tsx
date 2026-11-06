import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, useQueryClient, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform as RNPlatform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { onDeviceReset } from '../api/client';
import { checkServer, useServer } from '../api/server';
import { convert } from '@shared/pricing';
import type { FxRates } from '@shared/types';
import { setBackgroundChecks } from '../services/backgroundCheck';
import { runLocalCheck } from '../services/localAlerts';
import { syncWatches } from '../services/watchSync';
import { useWatchlist } from '../state/watchlist';
import { loadLinks, syncLinks } from '../state/links';
import { BackButton } from '../components/ui';
import { UpdateToast } from '../components/UpdateToast';
import { useNotificationTaps } from '../hooks/useNotificationTaps';
import { reconcilePermission, syncDevice } from '../services/push';
import { useSettings } from '../state/settings';
import { font, useTheme } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'gamely.cache', throttleTime: 2000 });

// React Native has no window focus events; treat "app came to the foreground" as focus
// so lists refetch when someone returns after a while.
if (RNPlatform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });
}

/**
 * Only small, useful queries are saved to disk for instant starts: exchange
 * rates, the watchlist, alerts, sale events and the default deals lists.
 * Search results and game pages are fetched fresh.
 */
function shouldPersist(q: Query): boolean {
  if (q.state.status !== 'success') return false;
  const [kind, , sort, filters] = q.queryKey as [string, unknown, unknown, Record<string, unknown> | undefined];
  if (kind === 'deals') return sort === 'popular' && (!filters || Object.values(filters).every((v) => v === undefined));
  return kind === 'fx' || kind === 'watches' || kind === 'activity' || kind === 'events';
}

/**
 * App-wide side effects. Rendered inside the query provider, because they
 * use the query client.
 */
function AppEffects() {
  const qc = useQueryClient();
  useNotificationTaps();
  const mode = useServer((x) => x.mode);
  const serverAddress = useSettings((x) => x.serverUrl);
  const alertsEnabled = useSettings((x) => x.alertsEnabled);
  const synced = useSettings(
    useShallow((s) => [s.homeRegion, s.homeCurrency, s.switchRegions, s.steamRegions, s.alertsEnabled, s.quietHours, s.quietStart, s.quietEnd, s.eventStoreSales, s.eventBigDeals, s.eventPlatforms, s.eventMinDiscount]),
  );
  const watchVersion = useWatchlist((x) => Object.values(x.items).map((w) => w.updatedAt).join(',') + x.removed.join(','));

  // Look for the server at launch and whenever its address changes
  useEffect(() => {
    void checkServer();
  }, [serverAddress]);

  // In phone-only mode, look again every couple of minutes so the app switches back on its own
  useEffect(() => {
    if (mode !== 'direct') return;
    const t = setInterval(() => void checkServer(), 2 * 60_000);
    return () => clearInterval(t);
  }, [mode]);

  // The server just became reachable (or the watchlist changed): bring it up to date
  useEffect(() => {
    if (mode !== 'server') return;
    void syncWatches();
  }, [mode, watchVersion]);

  // Keep a copy of the server's cross-region matches for phone-only mode (daily),
  // and read the stored copy at launch so phone-only screens know it's there
  useEffect(() => {
    void loadLinks();
  }, []);
  useEffect(() => {
    if (mode !== 'server') return;
    const t = setTimeout(() => void syncLinks(), 3000);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'server') return;
    const sync = () =>
      syncDevice()
        .then((sent) => {
          if (sent) qc.invalidateQueries({ queryKey: ['watches'] });
        })
        .catch(() => undefined);
    const t = setTimeout(sync, 400);
    return () => clearTimeout(t);
  }, [qc, mode, ...synced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Target prices follow a currency change made in Settings. Loading the saved
  // settings at launch also changes the currency (from the default), which
  // must not convert anything, so only count changes once both stores are loaded.
  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.homeCurrency === prev.homeCurrency) return;
        if (!useSettings.persist.hasHydrated() || !useWatchlist.persist.hasHydrated()) return;
        const fx = qc.getQueryData<FxRates>(['fx']);
        const rate = fx ? convert(1, prev.homeCurrency, s.homeCurrency, fx) : undefined;
        if (rate) useWatchlist.getState().convertTargets(rate);
      }),
    [qc],
  );

  useEffect(() => {
    void setBackgroundChecks(alertsEnabled);
  }, [alertsEnabled]);

  // Phone-side price check on open and on return, at most every 15 minutes
  useEffect(() => {
    let last = 0;
    const check = () => {
      if (Date.now() - last < 15 * 60_000) return;
      last = Date.now();
      runLocalCheck()
        .then(() => qc.invalidateQueries({ queryKey: ['activity'] }))
        .catch(() => undefined);
    };
    const first = setTimeout(check, 4000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void checkServer().then(() => {
        reconcilePermission()
          .catch(() => undefined)
          .finally(() => syncDevice().catch(() => undefined));
        check();
      });
    });
    // A new registration starts empty on the server: send settings straight away
    const off = onDeviceReset(() => void syncDevice().catch(() => undefined));
    return () => {
      clearTimeout(first);
      sub.remove();
      off();
    };
  }, [qc]);
  return null;
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: true, gcTime: 24 * 3600_000 } },
      }),
  );
  const [loaded] = useFonts({
    [font.regular]: SchibstedGrotesk_400Regular,
    [font.medium]: SchibstedGrotesk_500Medium,
    [font.semibold]: SchibstedGrotesk_600SemiBold,
    [font.bold]: SchibstedGrotesk_700Bold,
    [font.mono]: IBMPlexMono_400Regular,
    [font.monoMedium]: IBMPlexMono_500Medium,
    [font.monoSemibold]: IBMPlexMono_600SemiBold,
  });
  const { c, dark } = useTheme();

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  if (!loaded) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.line, primary: c.text } };

  return (
    <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: 24 * 3600_000, buster: 'v3', dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}>
      <AppEffects />
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: c.bg },
            headerShadowVisible: false,
            headerStyle: { backgroundColor: c.bg },
            headerTitleStyle: { fontFamily: font.semibold, fontSize: 17, color: c.text },
            headerTintColor: c.text,
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="game/[key]" options={{ title: '', headerTransparent: true, headerLeft: () => <BackButton /> }} />
          <Stack.Screen name="settings/regions" options={{ title: 'Regions' }} />
          <Stack.Screen name="settings/sources" options={{ title: 'Server and data' }} />
        </Stack>
        <UpdateToast />
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
