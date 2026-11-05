import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { STEAM_REGIONS, SWITCH_REGIONS, type Region } from '@shared/regions';
import { Group, haptic } from '../../components/ui';
import { useStatus } from '../../hooks/queries';
import { useSettings } from '../../state/settings';
import { space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const GROUPS: { id: Region['group']; label: string }[] = [
  { id: 'americas', label: 'Americas' },
  { id: 'europe', label: 'Europe, Oceania & South Africa' },
  { id: 'japan', label: 'Japan' },
];

function CheckRow({ label, detail, checked, onPress, first, locked }: { label: string; detail?: string; checked: boolean; onPress: () => void; first?: boolean; locked?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: locked }}
      disabled={locked}
      onPress={() => (haptic(), onPress())}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, { backgroundColor: pressed ? c.raised : 'transparent' }]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {detail ? (
          <Text variant="footnote" tone="subtle">
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={[styles.box, { borderColor: checked ? c.text : c.line, backgroundColor: checked ? c.text : 'transparent' }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={c.bg} /> : null}
      </View>
    </Pressable>
  );
}

export default function RegionsScreen() {
  const s = useSettings();
  const status = useStatus().data;
  const americasOff = status && !status.americasEnabled;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 64 }}>
      <Text variant="callout" tone="muted" style={{ paddingHorizontal: space.lg + space.xs, marginTop: space.md }}>
        Only switch on shops you can actually pay in. "Best price" and every alert only look at the regions ticked here.
      </Text>

      {GROUPS.map((g) => {
        const regions = SWITCH_REGIONS.filter((r) => r.group === g.id);
        const allOn = regions.every((r) => s.switchRegions.includes(r.code));
        const off = g.id === 'americas' && americasOff;
        return (
          <Group key={g.id} title={`Switch · ${g.label}`} footer={off ? "Prices for the Americas aren't available from our server yet, so these won't show for now." : undefined}>
            <CheckRow
              first
              label={allOn ? 'Deselect all' : 'Select all'}
              checked={allOn}
              onPress={() =>
                s.set({
                  switchRegions: allOn ? s.switchRegions.filter((x) => !regions.some((r) => r.code === x)) : [...new Set([...s.switchRegions, ...regions.map((r) => r.code)])],
                })
              }
            />
            {regions.map((r) => (
              <CheckRow
                key={r.code}
                label={`${r.flag}  ${r.name}`}
                detail={[r.code === s.homeRegion ? 'Your home eShop, always compared' : undefined, r.note].filter(Boolean).join(' · ') || undefined}
                checked={s.switchRegions.includes(r.code) || r.code === s.homeRegion}
                locked={r.code === s.homeRegion}
                onPress={() => s.toggleSwitchRegion(r.code)}
              />
            ))}
          </Group>
        );
      })}

      <Group title="Steam regions to compare" footer="Steam sells at your account country's price. Other regions are shown for comparison on each game page.">
        {STEAM_REGIONS.map((r, i) => (
          <CheckRow key={r.code} first={i === 0} label={`${r.flag}  ${r.name}`} detail={r.currency} checked={s.steamRegions.includes(r.code)} onPress={() => s.toggleSteamRegion(r.code)} />
        ))}
      </Group>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
