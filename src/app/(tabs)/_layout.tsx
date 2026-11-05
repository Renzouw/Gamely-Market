import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';
import { useWatchlist } from '../../state/watchlist';
import { useTheme } from '../../theme';

export default function TabsLayout() {
  const { c } = useTheme();
  const watchCount = useWatchlist((s) => Object.keys(s.items).length);
  const icon =
    (name: keyof typeof Ionicons.glyphMap) =>
    ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={typeof color === "string" ? color : undefined} size={size} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Deals', tabBarIcon: icon('pricetags') }} />
      <Tabs.Screen name="directory" options={{ title: 'Directory', tabBarIcon: icon('library') }} />
      <Tabs.Screen
        name="watchlist"
        options={{ title: 'Watchlist', tabBarIcon: icon('heart'), tabBarBadge: watchCount || undefined }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('options') }} />
    </Tabs>
  );
}
