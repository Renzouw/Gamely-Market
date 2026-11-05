import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkline } from '../../components/Sparkline';
import { Chip, ChipRow, EmptyState, Pill, PlatformTag } from '../../components/ui';
import { formatMoney } from '../../domain/pricing';
import { regionLabel } from '../../domain/regions';
import { useFx } from '../../hooks/queries';
import { refreshWatchlist } from '../../services/alerts';
import { useSettings } from '../../state/settings';
import { useWatchlist, type WatchItem } from '../../state/watchlist';
import { radius, space, useTheme } from '../../theme';

type Sort = 'target' | 'drop' | 'recent' | 'cheapest';
const AUTO_REFRESH_MS = 30 * 60 * 1000;

/** How far the price fell from the first time we saw it, as a fraction */
function dropSinceAdded(item: WatchItem): number {
  const first = item.history[0]?.best;
  if (!first || item.lastBest === undefined) return 0;
  return Math.max(0, 1 - item.lastBest / first);
}

export default function WatchlistScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const items = useWatchlist((s) => s.items);
  const currency = useSettings((s) => s.homeCurrency);
  const fx = useFx().data;
  const [sort, setSort] = useState<Sort>('target');
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string>();
  const lastRun = useRef(0);

  const refresh = useCallback(async () => {
    if (!Object.keys(useWatchlist.getState().items).length) return;
    setRefreshing(true);
    lastRun.current = Date.now();
    try {
      const r = await refreshWatchlist({ fx });
      setStatus(
        r.failed ? `Updated ${r.checked - r.failed} of ${r.checked}. Some stores didn't respond.` : `Updated just now`,
      );
    } finally {
      setRefreshing(false);
    }
  }, [fx]);

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastRun.current > AUTO_REFRESH_MS) refresh();
    }, [refresh]),
  );

  const list = useMemo(() => {
    const all = Object.values(items);
    const atTarget = (i: WatchItem) => i.target !== undefined && i.lastBest !== undefined && i.lastBest <= i.target;
    switch (sort) {
      case 'target':
        return all.sort((a, b) => Number(atTarget(b)) - Number(atTarget(a)) || dropSinceAdded(b) - dropSinceAdded(a));
      case 'drop':
        return all.sort((a, b) => dropSinceAdded(b) - dropSinceAdded(a));
      case 'cheapest':
        return all.sort((a, b) => (a.lastBest ?? Infinity) - (b.lastBest ?? Infinity));
      default:
        return all.sort((a, b) => b.addedAt - a.addedAt);
    }
  }, [items, sort]);

  const hitCount = list.filter((i) => i.target !== undefined && i.lastBest !== undefined && i.lastBest <= i.target).length;

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={list}
      keyExtractor={(i) => i.game.key}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.textDim} />}
      ListHeaderComponent={
        <View style={{ paddingTop: insets.top + space.md }}>
          <Text style={[styles.h1, { color: c.text }]}>Watchlist</Text>
          <Text style={[styles.subtitle, { color: c.textDim }]}>
            {list.length ? `${list.length} ${list.length === 1 ? 'game' : 'games'} · ${hitCount} at your price` : 'Your saved games'}
            {status ? ` · ${status}` : ''}
          </Text>
          {list.length > 1 ? (
            <ChipRow>
              <Chip label="At target first" active={sort === 'target'} onPress={() => setSort('target')} />
              <Chip label="Biggest drop" active={sort === 'drop'} onPress={() => setSort('drop')} />
              <Chip label="Cheapest" active={sort === 'cheapest'} onPress={() => setSort('cheapest')} />
              <Chip label="Recently added" active={sort === 'recent'} onPress={() => setSort('recent')} />
            </ChipRow>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="heart-outline"
          title="Nothing watched yet"
          body="Open any game and tap Watch price. You'll see its best price across your regions here, and can set a price to be alerted at."
          action={{ label: 'Browse deals', onPress: () => router.push('/') }}
        />
      }
      renderItem={({ item }) => {
        const r = item.lastCountry ? regionLabel(item.lastCountry) : undefined;
        const hit = item.target !== undefined && item.lastBest !== undefined && item.lastBest <= item.target;
        const drop = dropSinceAdded(item);
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/game/[key]', params: { key: item.game.key } })}
            style={({ pressed }) => [styles.card, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: hit ? c.good : c.border }]}
          >
            <View style={styles.row}>
              <Image source={item.game.image} style={[styles.thumb, { backgroundColor: c.surface2 }]} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
                  {item.game.title}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <PlatformTag platform={item.game.platform} />
                  {hit ? <Pill text="At your price" tone="good" icon="checkmark" /> : null}
                  {drop >= 0.01 ? <Pill text={`↓ ${Math.round(drop * 100)}% since added`} tone="good" /> : null}
                </View>
              </View>
            </View>
            <View style={styles.priceRow}>
              <View>
                <Text style={[styles.price, { color: hit ? c.good : c.text }]}>
                  {item.lastBest !== undefined ? formatMoney(item.lastBest, currency) : '–'}
                </Text>
                <Text style={{ color: c.textDim, fontSize: 12 }}>{r ? `${r.flag} ${r.name}` : 'Not checked yet'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: c.textDim, fontSize: 12 }}>Target</Text>
                <Text style={{ color: c.text, fontWeight: '700' }}>{item.target !== undefined ? formatMoney(item.target, currency) : 'Any drop'}</Text>
              </View>
            </View>
            {item.history.length >= 2 ? <Sparkline points={item.history} color={hit ? c.good : c.accent} height={36} /> : null}
          </Pressable>
        );
      }}
      contentContainerStyle={{ paddingBottom: space.xl }}
    />
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: space.lg },
  subtitle: { fontSize: 13.5, marginTop: 2, paddingHorizontal: space.lg, marginBottom: space.sm },
  card: { marginHorizontal: space.lg, marginTop: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  thumb: { width: 96, height: 54, borderRadius: radius.sm },
  title: { fontSize: 15, fontWeight: '700' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  price: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
