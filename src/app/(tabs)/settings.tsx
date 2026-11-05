import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Alert, Platform as RNPlatform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { americasCatalogEnabled } from '../../api/nintendo';
import { Chip, Segmented, SectionTitle } from '../../components/ui';
import { HOME_CURRENCIES, STEAM_REGIONS, SWITCH_REGIONS, type Region } from '../../domain/regions';
import { useFx } from '../../hooks/queries';
import { ensureNotificationPermission } from '../../services/alerts';
import { setBackgroundChecks } from '../../services/backgroundTask';
import { useSettings, type ThemePref } from '../../state/settings';
import { radius, space, useTheme } from '../../theme';

const GROUPS: { id: Region['group']; label: string }[] = [
  { id: 'americas', label: 'Americas' },
  { id: 'europe', label: 'Europe, Oceania & South Africa' },
  { id: 'japan', label: 'Japan' },
];

function Card({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>;
}

function Expandable({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.rowBetween} accessibilityRole="button">
        <Text style={[styles.rowLabel, { color: c.text }]}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: c.textDim, fontSize: 15 }}>{value}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textFaint} />
        </View>
      </Pressable>
      {open ? <View style={styles.wrap}>{children}</View> : null}
    </View>
  );
}

export default function SettingsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const fx = useFx().data;
  const qc = useQueryClient();
  const home = SWITCH_REGIONS.find((r) => r.code === s.homeRegion);

  const setAlerts = async (on: boolean) => {
    if (on) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        Alert.alert('Notifications are off', 'Allow notifications for Gamely in your phone settings to get price alerts.');
        return;
      }
    }
    s.set({ alertsEnabled: on });
    await setBackgroundChecks(on).catch(() => undefined);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: 48 }}>
      <Text style={[styles.h1, { color: c.text }]}>Settings</Text>

      <View style={styles.section}>
        <SectionTitle>You</SectionTitle>
        <Card>
          <Expandable title="Home eShop" value={home ? `${home.flag} ${home.name}` : s.homeRegion}>
            {SWITCH_REGIONS.map((r) => (
              <Chip
                key={r.code}
                label={`${r.flag} ${r.name}`}
                active={s.homeRegion === r.code}
                onPress={() => s.set({ homeRegion: r.code, homeCurrency: s.homeCurrency === home?.currency ? r.currency : s.homeCurrency })}
              />
            ))}
          </Expandable>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Expandable title="Show prices in" value={s.homeCurrency}>
            {HOME_CURRENCIES.map((cur) => (
              <Chip key={cur} label={cur} active={s.homeCurrency === cur} onPress={() => s.set({ homeCurrency: cur })} />
            ))}
          </Expandable>
        </Card>
        <Text style={[styles.help, { color: c.textDim }]}>
          Savings are worked out against your home eShop. Every price gets converted to your currency so regions compare fairly.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>Switch eShops you can buy from</SectionTitle>
        <Text style={[styles.help, { color: c.textDim, marginTop: 0, marginBottom: space.sm }]}>
          "Best price" only looks at regions you turn on here. Turn off any shop you can't pay in, so the deals you see are ones you can actually get.
        </Text>
        {GROUPS.map((g) => {
          const regions = SWITCH_REGIONS.filter((r) => r.group === g.id);
          const on = regions.filter((r) => s.switchRegions.includes(r.code)).length;
          const disabledGroup = g.id === 'americas' && !americasCatalogEnabled;
          return (
            <Card key={g.id}>
              <View style={styles.rowBetween}>
                <Text style={[styles.rowLabel, { color: c.text }]}>{g.label}</Text>
                <Pressable
                  onPress={() =>
                    s.set({
                      switchRegions:
                        on === regions.length
                          ? s.switchRegions.filter((x) => !regions.some((r) => r.code === x))
                          : [...new Set([...s.switchRegions, ...regions.map((r) => r.code)])],
                    })
                  }
                >
                  <Text style={{ color: c.accent, fontWeight: '700' }}>{on === regions.length ? 'None' : 'All'}</Text>
                </Pressable>
              </View>
              {disabledGroup ? (
                <Text style={[styles.help, { color: c.warn, marginTop: 4 }]}>
                  Needs the Americas catalog to be set up (see Data sources below).
                </Text>
              ) : null}
              <View style={styles.wrap}>
                {regions.map((r) => (
                  <Chip key={r.code} label={`${r.flag} ${r.code}`} active={s.switchRegions.includes(r.code)} onPress={() => s.toggleSwitchRegion(r.code)} />
                ))}
              </View>
            </Card>
          );
        })}
      </View>

      <View style={styles.section}>
        <SectionTitle>Steam regions to compare</SectionTitle>
        <Card>
          <View style={styles.wrap}>
            {STEAM_REGIONS.map((r) => (
              <Chip key={r.code} label={`${r.flag} ${r.code}`} active={s.steamRegions.includes(r.code)} onPress={() => s.toggleSteamRegion(r.code)} />
            ))}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>Price alerts</SectionTitle>
        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={[styles.rowLabel, { color: c.text }]}>Notify me</Text>
              <Text style={[styles.help, { color: c.textDim, marginTop: 2 }]}>
                Checks your watchlist in the background a few times a day. Your phone decides the exact timing.
              </Text>
            </View>
            <Switch value={s.alertsEnabled} onValueChange={setAlerts} disabled={RNPlatform.OS === 'web'} />
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>Appearance</SectionTitle>
        <Segmented<ThemePref>
          value={s.theme}
          onChange={(theme) => s.set({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </View>

      <View style={styles.section}>
        <SectionTitle>Data sources</SectionTitle>
        <Card>
          <Source ok label="Nintendo eShop prices" detail="Live prices straight from Nintendo, per country" />
          <Source ok label="Europe & Oceania catalog" detail="Nintendo of Europe game search" />
          <Source
            ok={americasCatalogEnabled}
            label="Americas catalog"
            detail={
              americasCatalogEnabled
                ? 'Connected'
                : 'Not set up. Add the search settings from .env.example to compare US, CA, MX, BR and other Americas eShops.'
            }
          />
          <Source ok label="Japan" detail="Matched by product code where possible" />
          <Source ok label="Steam" detail="Steam store prices per country" />
          <Source ok={!!fx} label="Exchange rates" detail={fx ? `Updated ${new Date(fx.updatedAt).toLocaleString()}` : 'Not loaded yet'} />
        </Card>
        <Pressable onPress={() => qc.invalidateQueries()} style={[styles.reload, { borderColor: c.border }]}>
          <Ionicons name="refresh" size={16} color={c.text} />
          <Text style={{ color: c.text, fontWeight: '700' }}>Reload all prices</Text>
        </Pressable>
        <Text style={[styles.help, { color: c.textFaint }]}>
          Gamely isn't affiliated with Nintendo or Valve. Prices can change at any time, so check the store before you buy.
        </Text>
      </View>
    </ScrollView>
  );
}

function Source({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.source}>
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={ok ? c.good : c.warn} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: c.textDim, fontSize: 12.5 }}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: space.lg },
  section: { paddingHorizontal: space.lg, marginTop: space.xl },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.md, marginBottom: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  rowLabel: { fontSize: 15.5, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.sm },
  help: { fontSize: 12.5, lineHeight: 18, marginTop: space.sm },
  source: { flexDirection: 'row', gap: space.sm, paddingVertical: 6 },
  reload: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, marginTop: space.sm },
});
