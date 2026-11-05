import '../services/backgroundTask';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useNotificationTaps } from '../hooks/useNotificationTaps';
import { useTheme } from '../theme';

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const { c, dark } = useTheme();
  useNotificationTaps();

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: c.bg,
      card: c.bg,
      text: c.text,
      border: c.border,
      primary: c.accent,
    },
  };

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="game/[key]"
            options={{ title: '', headerTransparent: true, headerTintColor: '#fff', headerBackButtonDisplayMode: 'minimal' }}
          />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
