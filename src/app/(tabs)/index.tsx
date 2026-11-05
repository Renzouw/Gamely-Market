import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { ApiListItem, DealSort } from '@shared/api';
import { formatMoney } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { Platform } from '@shared/types';
import { errorText } from '../../api/client';
import { GameRow } from '../../components/GameRow';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button, Chip, EmptyState, PlatformTabs, RowSkeleton, Sheet, SheetOption } from '../../components/ui';
import { useDeals, usePrefs, useSaleEvents, type DealFilters } from '../../hooks/queries';
import { enableAlerts } from '../../services/push';
import { useSettings } from '../../state/settings';
import { ago } from '../../lib/format';
import { GUTTER, platformMeta, radius, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const SORTS: { value: DealSort; label: string; detail: string }[] = [
  { value: 'popular', label: 'Popular', detail: 'What people are buying' },
  { value: 'discount', label: 'Biggest discount', detail: 'Deepest cuts first' },
  { value: 'cheapest', label: 'Lowest price', detail: 'Cheapest in your currency' },
  { value: 'ending', label: 'Ending soon', detail: 'Sales about to finish' },
  { value: 'newest', label: 'Newest releases', detail: 'Recently released games on sale' },
];

/** A round "under X" number that reads naturally in each currency */
function cheapLimit(currency: string): number {
  const t: Record<string, number> = { JPY: 1500, KRW: 15000, CLP: 10000, COP: 40000, ARS: 10000, MXN: 200, BRL: 50, ZAR: 200, INR: 800, NOK: 100, SEK: 100, DKK: 75, CZK: 250, PLN: 40, PHP: 500, IDR: 150000, VND: 250000, THB: 350, TRY: 350, HKD: 80, SGD: 15, MYR: 40 };
  return t[currency] ?? 10;
}

const PLATFORMS = (['switch2', 'switch', 'steam'] as Platform[]).map((p) => ({ value: p, label: platformMeta[p].label, dot: platformMeta[p].dot }));

export default function DealsScreen() {
  const { c } = useTheme();
  const prefs = usePrefs();
  const params = useLocalSearchParams<{ platform?: string }>();
  const [platform, setPlatform] = useState<Platform>('switch2');
  useEffect(() => {
    if (params.platform === 'switch2' || params.platform === 'switch' || params.platform === 'steam') setPlatform(params.platform);
  }, [params.platform]);
  const events = useSaleEvents().data ?? [];
  const liveEvent = events.find((e) => (platform === 'steam' ? e.platform === 'steam' : e.platform !== 'steam'));
  const alertsEnabled = useSettings((x) => x.alertsEnabled);
  const alertsPrompted = useSettings((x) => x.alertsPrompted);
  const showPrompt = !alertsEnabled && !alertsPrompted && RNPlatform.OS !== 'web';
  const [sort, setSort] = useState<DealSort>('popular');
  const [sortOpen, setSortOpen] = useState(false);
  const [big, setBig] = useState(false);
  const [cheap, setCheap] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const isSteam = platform === 'steam';
  const limit = cheapLimit(prefs.currency);

  const filters = useMemo<DealFilters>(
    () => ({ minDiscount: big ? 50 : undefined, maxPrice: cheap ? limit : undefined, abroad: abroad && !isSteam ? 0.15 : undefined }),
    [big, cheap, abroad, limit, isSteam],
  );
  const q = useDeals(platform, sort, filters);
  const regionCount = new Set([...prefs.switchRegions, prefs.home]).size;
  const sortLabel = SORTS.find((s) => s.value === sort)!.label;

  const subtitle = isSteam ? `Steam ${steamStoreCountry(prefs.home).code} store, in ${prefs.currency}` : `Best of ${regionCount} eShops, in ${prefs.currency}`;
  const freshness = ago(q.checkedAt);

  const renderItem = useCallback(({ item }: { item: ApiListItem }) => <GameRow game={item.game} prices={item.prices} />, []);

  const header = (
    <View>
      <ScreenHeader
        title="Deals"
        subtitle={
          <Text
            variant="footnote"
            tone="subtle"
            style={{ marginTop: 2 }}
            onPress={() => router.push('/settings/regions')}
            accessibilityRole="link"
            accessibilityHint="Choose which regions to compare"
          >
            {subtitle}
            {freshness ? ` · checked ${freshness}` : ''}
          </Text>
        }
      />
      <PlatformTabs value={platform} options={PLATFORMS} onChange={setPlatform} />
      {liveEvent ? (
        <View style={[styles.event, { backgroundColor: c.signalWash }]} accessible accessibilityLabel={`Big sale on now. ${liveEvent.count} games discounted.`}>
          <Ionicons name="megaphone" size={16} color={c.signalText} />
          <Text variant="footnoteMedium" tone="signal" style={{ flex: 1 }}>
            Big {liveEvent.platform === 'steam' ? 'Steam' : 'eShop'} sale on now · {liveEvent.count.toLocaleString()} games discounted
            {liveEvent.baseline > 0 && liveEvent.count / liveEvent.baseline >= 2 ? `, ${Math.round(liveEvent.count / liveEvent.baseline)}× a normal day` : ''}
          </Text>
        </View>
      ) : null}
      {showPrompt ? (
        <View style={[styles.prompt, { backgroundColor: c.surface }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">Hear about big sales first</Text>
              <Text variant="footnote" tone="muted">
                A heads-up when Steam or the eShop starts a major sale, plus the best deals on popular games. Nothing overnight.
              </Text>
            </View>
            <Pressable onPress={() => useSettings.getState().set({ alertsPrompted: true })} hitSlop={12} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={c.subtle} />
            </Pressable>
          </View>
          <Button label="Turn on alerts" onPress={() => void enableAlerts()} style={{ marginTop: space.md, height: 44 }} />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Chip label={sortLabel} trailing="chevron-down" onPress={() => setSortOpen(true)} />
        <View style={[styles.divider, { backgroundColor: c.line }]} />
        <Chip label="50% off or more" active={big} onPress={() => setBig((v) => !v)} />
        <Chip label={`Under ${formatMoney(limit, prefs.currency)}`} active={cheap} onPress={() => setCheap((v) => !v)} />
        {!isSteam ? <Chip label="Cheaper abroad" active={abroad} onPress={() => setAbroad((v) => !v)} /> : null}
      </ScrollView>
      {q.total !== undefined && q.items.length ? (
        <Text variant="caption" tone="subtle" style={styles.count}>
          {isSteam
            ? `The ${q.total.toLocaleString()} most popular Steam games on sale`
            : `${q.total.toLocaleString()} ${q.total === 1 ? 'game' : 'games'} on sale`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlashList
        data={q.items}
        keyExtractor={(it) => it.game.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          q.isPending ? (
            <RowSkeleton />
          ) : q.isError ? (
            <EmptyState title="Couldn't load deals" body={errorText(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
          ) : big || cheap || abroad ? (
            <EmptyState
              title="Nothing matches"
              body="No current sales fit those filters. Try removing one."
              action={{ label: 'Clear filters', onPress: () => (setBig(false), setCheap(false), setAbroad(false)) }}
            />
          ) : (
            <EmptyState title="No sales right now" body="Nothing is discounted in your regions at the moment. We check every few minutes." />
          )
        }
        onEndReachedThreshold={0.7}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.xxl }} color={c.subtle} /> : <View style={{ height: space.xxl }} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={c.subtle} />}
      />
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort deals">
        {SORTS.map((s) => (
          <SheetOption key={s.value} label={s.label} detail={s.detail} selected={sort === s.value} onPress={() => (setSort(s.value), setSortOpen(false))} />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { gap: space.sm, paddingHorizontal: GUTTER, paddingTop: space.md, paddingBottom: space.xs, alignItems: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space.xs },
  count: { paddingHorizontal: GUTTER, paddingTop: space.md },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: GUTTER, marginTop: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md },
  prompt: { marginHorizontal: GUTTER, marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
});
