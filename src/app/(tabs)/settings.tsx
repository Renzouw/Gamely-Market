import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform as RNPlatform, ScrollView, View } from 'react-native';
import { HOME_CURRENCIES, SWITCH_REGIONS } from '@shared/regions';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Group, Row, Sheet, SheetOption, SwitchRow } from '../../components/ui';
import { enableAlerts, syncDevice } from '../../services/push';
import { useSettings, type ThemePref } from '../../state/settings';
import { hourLabel } from '../../lib/format';
import { space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

type Picker = 'home' | 'currency' | 'quietStart' | 'quietEnd' | 'theme' | undefined;

const CURRENCY_NAMES: Record<string, string> = (() => {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'currency' });
    return Object.fromEntries(HOME_CURRENCIES.map((c) => [c, names.of(c) ?? c]));
  } catch {
    return Object.fromEntries(HOME_CURRENCIES.map((c) => [c, c]));
  }
})();

export default function SettingsScreen() {
  const { c } = useTheme();
  const s = useSettings();
  const qc = useQueryClient();
  const [picker, setPicker] = useState<Picker>();
  const home = SWITCH_REGIONS.find((r) => r.code === s.homeRegion);
  const regionCount = new Set([...s.switchRegions, s.homeRegion]).size;

  const toggleAlerts = async (on: boolean) => {
    if (!on) {
      s.set({ alertsEnabled: false });
      return;
    }
    const ok = await enableAlerts();
    if (!ok && RNPlatform.OS !== 'web') Linking.openSettings().catch(() => undefined);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 64 }}>
      <ScreenHeader title="Settings" />

      <Group title="Prices" footer="Savings are measured against your home eShop, and everything is converted to your currency so regions compare fairly.">
        <Row first label="Home eShop" value={home ? `${home.flag} ${home.name}` : s.homeRegion} onPress={() => setPicker('home')} />
        <Row label="Currency" value={s.homeCurrency} onPress={() => setPicker('currency')} />
        <Row label="Regions" value={`${regionCount} Switch · ${s.steamRegions.length} Steam`} onPress={() => router.push('/settings/regions')} />
      </Group>

      <Group title="Alerts" footer={s.quietHours ? `Alerts that land between ${hourLabel(s.quietStart)} and ${hourLabel(s.quietEnd)} wait until morning.` : undefined}>
        <SwitchRow first label="Price alerts" detail={RNPlatform.OS === 'web' ? 'Available in the iOS and Android apps' : 'For games on your watchlist'} value={s.alertsEnabled} onChange={toggleAlerts} disabled={RNPlatform.OS === 'web'} />
        <SwitchRow label="Quiet hours" value={s.quietHours} onChange={(v) => s.set({ quietHours: v })} />
        {s.quietHours ? (
          <>
            <Row label="From" value={hourLabel(s.quietStart)} onPress={() => setPicker('quietStart')} />
            <Row label="Until" value={hourLabel(s.quietEnd)} onPress={() => setPicker('quietEnd')} />
          </>
        ) : null}
      </Group>

      <Group title="App">
        <Row first label="Appearance" value={{ system: 'Match system', dark: 'Dark', light: 'Light' }[s.theme]} onPress={() => setPicker('theme')} />
        <Row label="Data sources" detail="Where prices come from and how fresh they are" onPress={() => router.push('/settings/sources')} />
        <Row
          label="Refresh everything"
          onPress={() => {
            qc.invalidateQueries();
            syncDevice().catch(() => undefined);
          }}
        />
      </Group>

      <Text variant="footnote" tone="subtle" style={{ textAlign: 'center', marginTop: space.xxxl, paddingHorizontal: space.xxl }}>
        Gamely isn't affiliated with Nintendo or Valve. Prices can change at any moment, so check the store before you buy.
      </Text>

      <Sheet visible={picker === 'home'} onClose={() => setPicker(undefined)} title="Home eShop">
        <ScrollView style={{ maxHeight: 460 }}>
          {SWITCH_REGIONS.map((r) => (
            <SheetOption
              key={r.code}
              label={`${r.flag}  ${r.name}`}
              selected={r.code === s.homeRegion}
              onPress={() => {
                // Follow the new region's currency unless the user picked one on purpose
                const followCurrency = s.homeCurrency === home?.currency;
                s.set({ homeRegion: r.code, ...(followCurrency ? { homeCurrency: r.currency } : {}) });
                setPicker(undefined);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
      <Sheet visible={picker === 'currency'} onClose={() => setPicker(undefined)} title="Show prices in">
        <ScrollView style={{ maxHeight: 460 }}>
          {HOME_CURRENCIES.map((cur) => (
            <SheetOption key={cur} label={cur} detail={CURRENCY_NAMES[cur]} selected={cur === s.homeCurrency} onPress={() => (s.set({ homeCurrency: cur }), setPicker(undefined))} />
          ))}
        </ScrollView>
      </Sheet>
      <Sheet visible={picker === 'quietStart' || picker === 'quietEnd'} onClose={() => setPicker(undefined)} title={picker === 'quietStart' ? 'Quiet from' : 'Quiet until'}>
        <ScrollView style={{ maxHeight: 420 }}>
          {Array.from({ length: 24 }, (_, h) => h).map((h) => (
            <SheetOption
              key={h}
              label={hourLabel(h)}
              selected={(picker === 'quietStart' ? s.quietStart : s.quietEnd) === h}
              onPress={() => (s.set(picker === 'quietStart' ? { quietStart: h } : { quietEnd: h }), setPicker(undefined))}
            />
          ))}
        </ScrollView>
      </Sheet>
      <Sheet visible={picker === 'theme'} onClose={() => setPicker(undefined)} title="Appearance">
        {(['system', 'dark', 'light'] as ThemePref[]).map((t) => (
          <SheetOption key={t} label={{ system: 'Match system', dark: 'Dark', light: 'Light' }[t]} selected={s.theme === t} onPress={() => (s.set({ theme: t }), setPicker(undefined))} />
        ))}
        <View style={{ height: space.sm }} />
      </Sheet>
    </ScrollView>
  );
}
