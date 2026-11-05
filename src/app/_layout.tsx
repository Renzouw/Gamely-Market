import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { BackButton } from '../components/ui';
import { useNotificationTaps } from '../hooks/useNotificationTaps';
import { syncDevice } from '../services/push';
import { useSettings } from '../state/settings';
import { font, useTheme } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'gamely.cache', throttleTime: 2000 });

/** Keep the server in step with this phone's settings, and refresh push tokens when the app comes back. */
function useDeviceSync() {
  const settings = useSettings();
  useEffect(() => {
    const t = setTimeout(() => syncDevice().catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [settings.homeRegion, settings.homeCurrency, settings.switchRegions, settings.steamRegions, settings.alertsEnabled, settings.quietHours, settings.quietStart, settings.quietEnd]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && syncDevice().catch(() => undefined));
    return () => sub.remove();
  }, []);
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
  useNotificationTaps();
  useDeviceSync();

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  if (!loaded) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.line, primary: c.text } };

  return (
    <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: 24 * 3600_000, buster: 'v2' }}>
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
