import { Ionicons } from '@expo/vector-icons';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Group, Row } from '../../components/ui';
import { useFx, useStatus } from '../../hooks/queries';
import { ago, shortDate } from '../../lib/format';
import { pushUnavailableReason } from '../../services/push';
import { space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const ORDER = ['nintendo-prices', 'nintendo-eu-catalog', 'nintendo-us-catalog', 'nintendo-jp-catalog', 'steam-prices', 'steam-specials', 'fx'];

export default function SourcesScreen() {
  const { c } = useTheme();
  const status = useStatus();
  const fx = useFx().data;
  const push = pushUnavailableReason();
  const sources = [...(status.data?.sources ?? [])].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
  const market = fx ? Object.entries(fx.sources).filter(([, s]) => s === 'market').map(([cur]) => cur) : [];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 64 }} refreshControl={<RefreshControl refreshing={status.isRefetching} onRefresh={() => void status.refetch()} tintColor={c.subtle} />}>
      <Text variant="callout" tone="muted" style={{ paddingHorizontal: space.lg + space.xs, marginTop: space.md }}>
        Every price comes straight from the store that sells the game. Our server checks watched games every 10 minutes, everything on sale every 30 minutes, and the full catalog once a day.
      </Text>

      <Group title="Stores">
        {sources.length ? (
          sources.map((src, i) => (
            <Row
              key={src.source}
              first={i === 0}
              label={src.label}
              detail={src.healthy ? `Last checked ${ago(src.lastOk)}` : src.lastOk ? `Having trouble since ${ago(src.lastErrorAt)}. Showing prices from ${ago(src.lastOk)}.` : 'Not checked yet'}
              icon={<Ionicons name={src.healthy ? 'checkmark-circle' : 'alert-circle'} size={20} color={src.healthy ? c.signalText : c.warn} />}
            />
          ))
        ) : (
          <Row first label={status.isError ? "Can't reach the Gamely server" : 'Loading…'} />
        )}
        {status.data && !status.data.americasEnabled ? (
          <Row label="Nintendo Americas" detail="Not connected yet. US, Canada, Mexico and Latin American eShops are left out rather than guessed." icon={<Ionicons name="remove-circle" size={20} color={c.subtle} />} />
        ) : null}
      </Group>

      <Group
        title="Exchange rates"
        footer={market.length ? `The European Central Bank doesn't publish ${market.join(', ')}, so those use a market rate.` : undefined}
      >
        <Row first label="European Central Bank" value={fx ? shortDate(fx.asOf) : '–'} detail="Daily reference rates" />
      </Group>

      <Group title="This phone">
        <Row first label="Push alerts" detail={push ?? 'Ready'} icon={<Ionicons name={push ? 'alert-circle' : 'checkmark-circle'} size={20} color={push ? c.warn : c.signalText} />} />
      </Group>
      <View style={{ height: space.xl }} />
    </ScrollView>
  );
}
