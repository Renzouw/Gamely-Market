import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { checkServer, DEFAULT_SERVER_URL, useServer } from '../../api/server';
import { Button, Group, Row } from '../../components/ui';
import { useFx, useStatus } from '../../hooks/queries';
import { ago, shortDate } from '../../lib/format';
import { pushUnavailableReason } from '../../services/push';
import { useLinkCount } from '../../state/links';
import { useSettings } from '../../state/settings';
import { font, radius, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const ORDER = ['nintendo-prices', 'nintendo-eu-catalog', 'nintendo-us-catalog', 'nintendo-jp-catalog', 'steam-prices', 'steam-specials', 'fx'];

export default function SourcesScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const server = useServer();
  const saved = useSettings((s) => s.serverUrl);
  const [address, setAddress] = useState(saved || DEFAULT_SERVER_URL);
  const [checking, setChecking] = useState(false);
  const status = useStatus();
  const haveMatches = useLinkCount((x) => x.count > 0);
  const fx = useFx().data;
  const push = pushUnavailableReason();
  const connected = server.mode === 'server';
  const sources = [...(status.data?.sources ?? [])].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
  const market = fx ? Object.entries(fx.sources).filter(([, s]) => s === 'market').map(([cur]) => cur) : [];

  const connect = async () => {
    setChecking(true);
    const clean = address.trim().replace(/\/$/, '');
    // Accept "192.168.1.20" or "192.168.1.20:8787" as well as a full address
    const full = !clean ? '' : /^https?:\/\//.test(clean) ? clean : `http://${clean}${/:\d+$/.test(clean) ? '' : ':8787'}`;
    setAddress(full);
    useSettings.getState().set({ serverUrl: full });
    await checkServer();
    setChecking(false);
    qc.invalidateQueries();
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 64 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={status.isRefetching} onRefresh={() => void checkServer().then(() => status.refetch())} tintColor={c.subtle} />}
    >
      <Group
        title="Your Gamely server"
        footer={
          connected
            ? 'Your server checks watched games every 10 minutes and sends alerts even when this app is closed.'
            : 'Phone-only mode: prices come straight from the stores. Alerts are checked when you open the app and a few times a day. Everything switches back on its own when the server is reachable again.'
        }
      >
        <Row
          first
          label={connected ? 'Connected' : server.mode === undefined ? 'Looking for your server…' : 'Not reachable'}
          detail={connected ? `Last answered ${ago(server.lastOk)}` : server.lastOk ? `Last reached ${ago(server.lastOk)}` : 'Using phone-only mode'}
          icon={<Ionicons name={connected ? 'checkmark-circle' : 'cloud-offline-outline'} size={20} color={connected ? c.text : c.subtle} />}
        />
        <View style={[styles.addressRow, { borderTopColor: c.line }]}>
          <Text variant="footnote" tone="subtle">
            Server address
          </Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="192.168.1.20:8787"
            placeholderTextColor={c.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={() => void connect()}
            maxFontSizeMultiplier={1.3}
            accessibilityLabel="Server address"
            style={[styles.address, { color: c.text, backgroundColor: c.raised }]}
          />
          <Button label={checking ? 'Checking…' : 'Save and connect'} variant="secondary" loading={checking} onPress={() => void connect()} style={{ marginTop: space.sm, height: 44 }} />
        </View>
      </Group>
      <Text variant="footnote" tone="subtle" style={styles.hint}>
        On your PC, run “npm run setup” to see this address. Your phone and PC need to be on the same Wi-Fi.
      </Text>

      {connected ? (
        <Group title="Stores">
          {sources.length ? (
            sources.map((src, i) => (
              <Row
                key={src.source}
                first={i === 0}
                label={src.label}
                detail={src.healthy ? `Last checked ${ago(src.lastOk)}` : src.lastOk ? `Having trouble since ${ago(src.lastErrorAt)}. Showing prices from ${ago(src.lastOk)}.` : 'Not checked yet'}
                icon={<Ionicons name={src.healthy ? 'checkmark-circle' : 'alert-circle'} size={20} color={src.healthy ? c.text : c.warn} />}
              />
            ))
          ) : (
            <Row first label="Loading…" />
          )}
          {status.data && !status.data.americasEnabled ? (
            <Row label="Nintendo Americas" detail="Not connected yet. US, Canada, Mexico and Latin American eShops are left out rather than guessed." icon={<Ionicons name="remove-circle" size={20} color={c.subtle} />} />
          ) : null}
        </Group>
      ) : (
        <Group title="In phone-only mode">
          <Row
            first
            label="Nintendo eShop"
            detail={
              haveMatches
                ? 'Every region, live: Europe, Oceania and South Africa for all games, the Americas and Asia for the games your server matched.'
                : 'Europe, Oceania and South Africa, live. The Americas and Asia need your server to connect once first.'
            }
            icon={<Ionicons name="checkmark-circle" size={20} color={c.text} />}
          />
          <Row label="Steam" detail="Your store’s deals and every region’s price, live." icon={<Ionicons name="checkmark-circle" size={20} color={c.text} />} />
          <Row label="Needs the server" detail="Deals that run only outside Europe, games sold only in the Americas, store-wide sale alerts, and price history from before you installed the app." icon={<Ionicons name="remove-circle" size={20} color={c.subtle} />} />
        </Group>
      )}

      <Group title="Exchange rates" footer={market.length ? `The European Central Bank doesn’t publish ${market.join(', ')}, so those use a market rate.` : undefined}>
        <Row first label="European Central Bank" value={fx ? shortDate(fx.asOf) : '–'} detail="Daily reference rates" />
      </Group>

      <Group title="This phone">
        <Row
          first
          label="Instant push alerts"
          detail={push ?? (connected ? 'Ready' : 'When your server is reachable')}
          icon={<Ionicons name={push ? 'alert-circle' : 'checkmark-circle'} size={20} color={push ? c.warn : c.text} />}
        />
      </Group>
      <View style={{ height: space.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addressRow: { paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, gap: space.xs },
  address: { height: 44, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.mono, fontSize: 15 },
  hint: { marginTop: space.sm, marginHorizontal: 20 },
});
