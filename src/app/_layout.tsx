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
import { BackButton } from '../components/ui';
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
  const synced = useSettings(
    useShallow((s) => [s.homeRegion, s.homeCurrency, s.switchRegions, s.steamRegions, s.alertsEnabled, s.quietHours, s.quietStart, s.quietEnd, s.eventStoreSales, s.eventBigDeals, s.eventPlatforms, s.eventMinDiscount]),
  );

  useEffect(() => {
    const sync = () =>
      syncDevice()
        .then((sent) => {
          // The server may have converted target prices to a new currency
          if (sent) qc.invalidateQueries({ queryKey: ['watches'] });
        })
        .catch(() => undefined);
    const t = setTimeout(sync, 400);
    return () => clearTimeout(t);
  }, [qc, ...synced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      reconcilePermission()
        .catch(() => undefined)
        .finally(() => syncDevice().catch(() => undefined));
    });
    // A new registration starts empty on the server: send settings straight away
    const off = onDeviceReset(() => void syncDevice().catch(() => undefined));
    return () => {
      sub.remove();
      off();
    };
  }, []);
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
          <Stack.Screen name="settings/sources" options={{ title: 'Data sources' }} />
        </Stack>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
