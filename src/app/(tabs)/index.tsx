import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { friendlyError } from '../../api/http';
import { GameRow } from '../../components/GameRow';
import { Chip, ChipRow, EmptyState, ListSkeleton, Segmented } from '../../components/ui';
import { americasCatalogEnabled } from '../../api/nintendo';
import { endsSoon, formatMoney, summarize } from '../../domain/pricing';
import { steamStoreCountry } from '../../domain/regions';
import type { Platform } from '../../domain/types';
import { useDeals, useFx, usePriceContext, type DealSort, type ListedGame } from '../../hooks/queries';
import { platformMeta, space, useTheme } from '../../theme';

const SORTS: { value: DealSort; label: string; icon: 'flame' | 'trending-down' | 'cash-outline' | 'time-outline' | 'sparkles' }[] = [
  { value: 'popular', label: 'Popular', icon: 'flame' },
  { value: 'discount', label: 'Biggest cut', icon: 'trending-down' },
  { value: 'cheapest', label: 'Cheapest', icon: 'cash-outline' },
  { value: 'ending', label: 'Ending soon', icon: 'time-outline' },
  { value: 'newest', label: 'Newest', icon: 'sparkles' },
];

/** Price thresholds that read naturally in each currency */
function underThreshold(currency: string): number {
  const table: Record<string, number> = { JPY: 1500, KRW: 15000, CLP: 10000, COP: 40000, ARS: 10000, MXN: 200, BRL: 50, ZAR: 200, INR: 800, NOK: 100, SEK: 100, DKK: 75, CZK: 250, PLN: 40, PHP: 500, IDR: 150000, VND: 250000, THB: 350, TRY: 350 };
  return table[currency] ?? 10;
}

export default function DealsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [platform, setPlatform] = useState<Platform>('switch2');
  const [sort, setSort] = useState<DealSort>('popular');
  const [bigCuts, setBigCuts] = useState(false);
  const [cheap, setCheap] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const ctx = usePriceContext();
  const fx = useFx().data;
  const q = useDeals(platform, sort);
  const limit = underThreshold(ctx.homeCurrency);
  const isSteam = platform === 'steam';

  const items = useMemo(() => {
    const all: ListedGame[] = [];
    const seen = new Set<string>();
    for (const page of q.data?.pages ?? []) for (const it of page.items) if (!seen.has(it.game.key)) (seen.add(it.game.key), all.push(it));
    const home = isSteam ? steamStoreCountry(ctx.homeRegion).code : ctx.homeRegion;
    const scored = all.map((it) => ({ it, s: summarize(it.prices, { homeCurrency: ctx.homeCurrency, homeRegion: home, fx }) }));
    let list = scored;
    if (bigCuts) list = list.filter(({ s }) => (s.best?.discountPercent ?? 0) >= 50);
    if (cheap) list = list.filter(({ s }) => s.best?.converted !== undefined && s.best.converted <= limit);
    if (abroad && !isSteam) list = list.filter(({ s }) => (s.savingVsHome ?? 0) >= 0.15);
    if (sort === 'cheapest') list = [...list].sort((a, b) => (a.s.best?.converted ?? Infinity) - (b.s.best?.converted ?? Infinity));
    if (sort === 'discount') list = [...list].sort((a, b) => (b.s.best?.discountPercent ?? 0) - (a.s.best?.discountPercent ?? 0));
    if (sort === 'ending') {
      const end = (x: (typeof scored)[number]) => Date.parse(x.s.best?.saleEndsAt ?? '') || Infinity;
      list = [...list].sort((a, b) => end(a) - end(b));
    }
    return list.map(({ it }) => it);
  }, [q.data, ctx.homeCurrency, ctx.homeRegion, fx, bigCuts, cheap, abroad, sort, limit, isSteam]);

  const total = q.data?.pages[0]?.total;
  const endingCount = useMemo(
    () => items.filter((it) => it.prices.some((p) => endsSoon(p.saleEndsAt))).length,
    [items],
  );
  const regionCount = isSteam ? 1 : new Set(ctx.switchRegions.concat(ctx.homeRegion)).size;

  const header = (
    <View style={{ paddingTop: insets.top + space.md }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: c.text }]}>Deals</Text>
          <Text style={[styles.subtitle, { color: c.textDim }]}>
            {isSteam
              ? `Steam ${steamStoreCountry(ctx.homeRegion).code} store, shown in ${ctx.homeCurrency}`
              : `Best price across ${regionCount} eShops, in ${ctx.homeCurrency}`}
            {total ? ` · ${total.toLocaleString()} on sale` : ''}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <Segmented
          value={platform}
          onChange={setPlatform}
          options={(['switch2', 'switch', 'steam'] as Platform[]).map((p) => ({ value: p, label: platformMeta[p].label, color: platformMeta[p].color }))}
        />
      </View>
      <ChipRow style={{ paddingTop: space.md }}>
        {SORTS.filter((s) => !(isSteam && s.value === 'ending')).map((s) => (
          <Chip key={s.value} label={s.label} icon={s.icon} active={sort === s.value} onPress={() => setSort(s.value)} />
        ))}
      </ChipRow>
      <ChipRow style={{ paddingTop: 0 }}>
        <Chip label="50%+ off" active={bigCuts} onPress={() => setBigCuts((v) => !v)} color={c.good} />
        <Chip label={`Under ${formatMoney(limit, ctx.homeCurrency)}`} active={cheap} onPress={() => setCheap((v) => !v)} color={c.good} />
        {!isSteam ? <Chip label="Cheaper abroad" icon="globe-outline" active={abroad} onPress={() => setAbroad((v) => !v)} color={c.good} /> : null}
      </ChipRow>
      {!isSteam && !americasCatalogEnabled ? (
        <Text onPress={() => router.push('/settings')} style={[styles.notice, { color: c.textDim, backgroundColor: c.surface }]}>
          <Ionicons name="information-circle-outline" size={13} color={c.textDim} /> Americas eShops are off until the catalog is set up. Tap for details.
        </Text>
      ) : null}
      {!isSteam && endingCount > 0 && sort !== 'ending' ? (
        <Text onPress={() => setSort('ending')} style={[styles.notice, { color: c.warn, backgroundColor: c.warnBg }]}>
          <Ionicons name="time-outline" size={13} color={c.warn} /> {endingCount} of these end within 48 hours
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={items}
      keyExtractor={(it) => it.game.key}
      renderItem={({ item }) => <GameRow game={item.game} prices={item.prices} />}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
      ListEmptyComponent={
        q.isPending ? (
          <ListSkeleton />
        ) : q.isError ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load deals" body={friendlyError(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
        ) : (
          <EmptyState icon="search-outline" title="No deals match" body="Try removing a filter or switching platform." />
        )
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.xl }} color={c.textDim} /> : <View style={{ height: space.xl }} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={c.textDim} />}
    />
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.lg },
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, marginTop: 2 },
  notice: { marginHorizontal: space.lg, marginTop: space.sm, padding: space.sm, borderRadius: 8, fontSize: 12.5, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 128 + space.md },
});
