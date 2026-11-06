import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { ApiListItem, DealSort } from '@shared/api';
import { formatMoney } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { Platform } from '@shared/types';
import { errorText } from '../../api/client';
import { CountryChip, useCountry, useHomePriced } from '../../components/CountryFilter';
import { GameRow } from '../../components/GameRow';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button, Chip, EmptyState, PlatformTabs, RowSkeleton, Sheet, SheetOption } from '../../components/ui';
import { directSwitchCountries } from '../../direct';
import { useDataMode, useDeals, usePrefs, useSaleEvents, type DealFilters } from '../../hooks/queries';
import { turnOnAlerts } from '../../services/turnOnAlerts';
import { useSettings } from '../../state/settings';
import { ago, cheapLimit } from '../../lib/format';
import { GUTTER, platformMeta, radius, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const SORTS: { value: DealSort; label: string; detail: string }[] = [
  { value: 'popular', label: 'Popular', detail: 'What people are buying' },
  { value: 'discount', label: 'Biggest discount', detail: 'Deepest cuts first' },
  { value: 'cheapest', label: 'Lowest price', detail: 'Cheapest in your currency' },
  { value: 'ending', label: 'Ending soon', detail: 'Sales about to finish' },
  { value: 'newest', label: 'Newest releases', detail: 'Recently released games on sale' },
];


const PLATFORMS = (['switch2', 'switch', 'steam'] as Platform[]).map((p) => ({ value: p, label: platformMeta[p].label, dot: platformMeta[p].dot }));

export default function DealsScreen() {
  const { c } = useTheme();
  const prefs = usePrefs();
  const params = useLocalSearchParams<{ platform?: string }>();
  const paramPlatform = PLATFORMS.find((p) => p.value === params.platform)?.value;
  const [platform, setPlatform] = useState<Platform>(paramPlatform ?? 'switch2');
  // A notification tap can ask for a tab; follow it when the param changes
  const [seenParam, setSeenParam] = useState(params.platform);
  if (params.platform !== seenParam) {
    setSeenParam(params.platform);
    if (paramPlatform) setPlatform(paramPlatform);
  }
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
  const [countryCode, setCountry] = useState<string>();
  const isSteam = platform === 'steam';
  // Steam charges your account's country, so there's no picking another one
  const country = useCountry(isSteam ? undefined : countryCode);
  const canAbroad = useHomePriced() && !country;
  const limit = cheapLimit(prefs.currency);

  const filters = useMemo<DealFilters>(
    () => ({
      minDiscount: big ? 50 : undefined,
      maxPrice: cheap ? limit : undefined,
      // Cheaper abroad compares with home, which doesn't apply to a single eShop
      abroad: abroad && !isSteam && canAbroad ? 0.15 : undefined,
      country: country?.code,
    }),
    [big, cheap, abroad, limit, isSteam, country, canAbroad],
  );
  const q = useDeals(platform, sort, filters);
  const mode = useDataMode();
  const phoneOnly = mode === 'direct';
  // Phone-only mode can price the Europe/Oceania eShops; the rest need the server
  const regionCount = phoneOnly
    ? directSwitchCountries({ home: prefs.home, currency: prefs.currency, switchRegions: prefs.switchRegions, steamRegions: prefs.steamRegions }).length
    : new Set([...prefs.switchRegions, prefs.home]).size;
  const sortLabel = SORTS.find((s) => s.value === sort)!.label;

  const subtitle = isSteam
    ? `Steam ${steamStoreCountry(prefs.home).code} store, in ${prefs.currency}`
    : country
      ? `${country.flag} ${country.name} eShop only, in ${prefs.currency}`
      : `Best of ${regionCount} eShops, in ${prefs.currency}`;
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
            onPress={() => router.push(phoneOnly ? '/settings/sources' : '/settings/regions')}
            accessibilityRole="link"
            accessibilityHint="Choose which regions to compare"
          >
            {subtitle}
            {phoneOnly ? ' · phone-only mode' : freshness ? ` · checked ${freshness}` : ''}
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
          <Button label="Turn on alerts" onPress={() => void turnOnAlerts()} style={{ marginTop: space.md, height: 44 }} />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Chip label={sortLabel} trailing="chevron-down" onPress={() => setSortOpen(true)} />
        {!isSteam ? <CountryChip value={country?.code} onChange={setCountry} /> : null}
        <View style={[styles.divider, { backgroundColor: c.line }]} />
        <Chip label="50% off or more" active={big} onPress={() => setBig((v) => !v)} />
        <Chip label={`Under ${formatMoney(limit, prefs.currency)}`} active={cheap} onPress={() => setCheap((v) => !v)} />
        {!isSteam && canAbroad ? <Chip label="Cheaper abroad" active={abroad} onPress={() => setAbroad((v) => !v)} /> : null}
      </ScrollView>
      {q.total !== undefined && q.items.length ? (
        <Text variant="caption" tone="subtle" style={styles.count}>
          {isSteam
            ? `The ${q.total.toLocaleString()} most popular Steam games on sale`
            : `${q.total.toLocaleString()} ${q.total === 1 ? 'game' : 'games'} on sale${country ? ` in ${country.name}` : ''}`}
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
            <EmptyState title="Couldn’t load deals" body={errorText(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
          ) : big || cheap || abroad || country ? (
            <EmptyState
              title="Nothing matches"
              body={country && !big && !cheap ? `Nothing is on sale in the ${country.name} eShop right now.` : 'No current sales fit those filters. Try removing one.'}
              action={{ label: 'Clear filters', onPress: () => (setBig(false), setCheap(false), setAbroad(false), setCountry(undefined)) }}
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
