import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';
import { font, useTheme } from '../../theme';

type Icon = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
  const { c } = useTheme();
  const icon = (on: Icon, off: Icon) =>
    function TabIcon({ color, focused }: { color: unknown; focused: boolean }) {
      return <Ionicons name={focused ? on : off} size={23} color={typeof color === 'string' ? color : c.text} />;
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.subtle,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11.5 },
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Deals', tabBarIcon: icon('pricetag', 'pricetag-outline') }} />
      <Tabs.Screen name="directory" options={{ title: 'Directory', tabBarIcon: icon('albums', 'albums-outline') }} />
      <Tabs.Screen name="cards" options={{ title: 'Cards', tabBarIcon: icon('card', 'card-outline') }} />
      <Tabs.Screen name="watchlist" options={{ title: 'Watchlist', tabBarIcon: icon('notifications', 'notifications-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
