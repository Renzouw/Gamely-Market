import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { ApiActivity, ApiWatch } from '@shared/api';
import { formatMoney, summarize } from '@shared/pricing';
import { regionLabel, steamStoreCountry } from '@shared/regions';
import type { FxRates } from '@shared/types';
import { errorText } from '../../api/client';
import { ScreenHeader } from '../../components/ScreenHeader';
import { showToast } from '../../components/Toast';
import { Cover, EmptyState, haptic, PlatformTabs, RowSkeleton, Tap } from '../../components/ui';
import { useActivity, useFx, usePrefs, usePriceSummary, useWatchActions, useWatches } from '../../hooks/queries';
import { useWatchlist } from '../../state/watchlist';
import { ago } from '../../lib/format';
import { GUTTER, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

type Tab = 'watching' | 'alerts';
/** Where the prices stand for rows that have none yet */
type Fetch = 'loading' | 'error' | 'done';

/** The price a watch is judged on: the cheapest region (Switch), or your own store (Steam, which charges your account's country). */
function buyingPrice(w: ApiWatch, home: string, currency: string, fx: FxRates | undefined) {
  const steam = w.game.platform === 'steam';
  const s = summarize(w.prices, { homeCurrency: currency, homeRegion: steam ? steamStoreCountry(home).code : home, fx });
  return steam ? (s.home ?? s.best) : s.best;
}

/** How worth buying a watch is right now: 0 at your price, 1 lowest yet, 2 on sale, 3 the rest. */
function standing(w: ApiWatch, best: ReturnType<typeof buyingPrice>): number {
  if (w.target !== undefined && best?.converted !== undefined && best.converted <= w.target + 0.005) return 0;
  if (best?.converted !== undefined && w.lowest && best.converted <= w.lowest.price + 0.01 && best.sale) return 1;
  return best?.sale ? 2 : 3;
}

/** Stop watching, with Undo that brings back the target price and alert switches */
function stopWatching(key: string, title: string, actions: ReturnType<typeof useWatchActions>) {
  const was = useWatchlist.getState().items[key];
  if (!was) return;
  haptic('light');
  actions.remove.mutate(key);
  showToast(`Stopped watching ${title}`, { label: 'Undo', onPress: () => actions.restore.mutate(was) });
}

const WatchRow = memo(function WatchRow({ w, fetch }: { w: ApiWatch; fetch: Fetch }) {
  const s = usePriceSummary(w.game.platform, w.prices);
  const actions = useWatchActions();
  const best = w.game.platform === 'steam' ? (s.home ?? s.best) : s.best;
  const rank = standing(w, best);
  const atTarget = rank === 0;

  let status: { text: string; tone: 'signal' | 'muted' | 'subtle' | 'warn' };
  // No prices yet: say why, rather than guessing there's no sale
  if (!w.prices.length) {
    status =
      fetch === 'loading'
        ? { text: 'Checking price…', tone: 'subtle' }
        : fetch === 'error'
          ? { text: 'Couldn’t check the price', tone: 'warn' }
          : { text: 'Not sold in your regions', tone: 'subtle' };
  } else if (atTarget) status = { text: 'At your price', tone: 'signal' };
  else if (rank === 1) status = { text: 'Lowest price yet', tone: 'signal' };
  else if (best?.sale) status = { text: `On sale in ${regionLabel(best.country).name}`, tone: 'muted' };
  else if (w.target !== undefined && best?.converted !== undefined) status = { text: `${formatMoney(best.converted - w.target, s.currency)} above your price`, tone: 'subtle' };
  else status = { text: 'Waiting for a sale', tone: 'subtle' };

  return (
    <Tap
      onPress={() => router.push({ pathname: '/game/[key]', params: { key: w.game.key } })}
      onLongPress={() => stopWatching(w.game.key, w.game.title, actions)}
      accessibilityRole="button"
      accessibilityHint="Long press to stop watching"
      accessibilityActions={[{ name: 'longpress', label: 'Stop watching' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && stopWatching(w.game.key, w.game.title, actions)}
      accessibilityLabel={`${w.game.title}, ${best?.converted !== undefined ? formatMoney(best.converted, s.currency) : 'no price'}, ${status.text}`}
      scaleTo={0.985}
      style={styles.row}
    >
      <Cover uri={w.game.image} title={w.game.title} platform={w.game.platform} width={106} height={60} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {w.game.title}
        </Text>
        <Text variant="footnote" tone={status.tone} numberOfLines={1}>
          {status.text}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 72 }}>
        <Text variant="priceM" tone={atTarget ? 'signal' : 'text'}>
          {best?.converted !== undefined ? formatMoney(best.converted, s.currency) : '–'}
        </Text>
        {best?.discountPercent ? (
          <Text variant="priceXS" tone="signal">
            −{best.discountPercent}%
          </Text>
        ) : w.target !== undefined ? (
          <Text variant="priceXS" tone="subtle">
            ≤ {formatMoney(w.target, s.currency)}
          </Text>
        ) : null}
      </View>
    </Tap>
  );
});

const KIND_ICON: Record<ApiActivity['kind'], keyof typeof Ionicons.glyphMap> = {
  sale: 'pricetag',
  drop: 'trending-down',
  target: 'locate',
  low: 'ribbon',
  ending: 'time',
  digest: 'albums',
  event: 'megaphone',
  deals: 'flame',
};

const AlertRow = memo(function AlertRow({ a }: { a: ApiActivity }) {
  const { c } = useTheme();
  return (
    <Tap
      disabled={!a.gameId}
      onPress={() => a.gameId && router.push({ pathname: '/game/[key]', params: { key: a.gameId } })}
      accessibilityRole="button"
      accessibilityState={{ disabled: !a.gameId }}
      accessibilityLabel={`${a.title}. ${a.body}. ${ago(a.createdAt)}`}
      scaleTo={0.985}
      style={styles.alert}
    >
      <View style={[styles.alertIcon, { backgroundColor: a.kind === 'ending' ? c.warnWash : c.signalWash }]}>
        <Ionicons name={KIND_ICON[a.kind]} size={16} color={a.kind === 'ending' ? c.warn : c.signalText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Text variant="bodyMedium" style={{ flex: 1 }} numberOfLines={2}>
            {a.title}
          </Text>
          <Text variant="caption" tone="subtle">
            {ago(a.createdAt)}
          </Text>
        </View>
        <Text variant="footnote" tone="muted">
          {a.body}
        </Text>
      </View>
    </Tap>
  );
});

export default function WatchlistScreen() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'alerts' ? 'alerts' : 'watching');
  const [seenTab, setSeenTab] = useState(params.tab);
  if (params.tab !== seenTab) {
    setSeenTab(params.tab);
    if (params.tab === 'alerts') setTab('alerts');
  }
  const watches = useWatches();
  const activity = useActivity();
  const prefs = usePrefs();
  const fx = useFx().data;

  // Worth buying first (at your price, lowest yet, on sale), newest first within each
  const sorted = useMemo(() => {
    const list = watches.data ?? [];
    const rank = new Map(list.map((w) => [w.game.key, standing(w, buyingPrice(w, prefs.home, prefs.currency, fx))]));
    return [...list].sort((a, b) => rank.get(a.game.key)! - rank.get(b.game.key)!);
  }, [watches.data, prefs.home, prefs.currency, fx]);
  const fetch: Fetch = watches.isFetching ? 'loading' : watches.isError ? 'error' : 'done';
  const renderWatch = useCallback(({ item }: { item: ApiWatch }) => <WatchRow w={item} fetch={fetch} />, [fetch]);
  const renderAlert = useCallback(({ item }: { item: ApiActivity }) => <AlertRow a={item} />, []);
  // Counted the same way each row decides it says "on sale"
  const onSale = useMemo(() => sorted.filter((w) => buyingPrice(w, prefs.home, prefs.currency, fx)?.sale).length, [sorted, prefs.home, prefs.currency, fx]);

  const header = (
    <View>
      <ScreenHeader
        title="Watchlist"
        subtitle={sorted.length ? `${sorted.length} ${sorted.length === 1 ? 'game' : 'games'}${onSale ? ` · ${onSale} on sale now` : ''}` : undefined}
      />
      {tab === 'watching' && watches.isError && sorted.length ? (
        <Text variant="footnote" tone="warn" style={styles.note} onPress={() => void watches.refetch()} accessibilityRole="button">
          Couldn’t refresh prices. Tap to try again.
        </Text>
      ) : null}
      <PlatformTabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'watching', label: 'Watching' },
          { value: 'alerts', label: 'Alerts' },
        ]}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {tab === 'watching' ? (
        <FlashList
          key="watching"
          data={sorted}
          extraData={fetch}
          keyExtractor={(w) => w.game.key}
          renderItem={renderWatch}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={watches.isRefetching} onRefresh={() => void watches.refetch()} tintColor={c.subtle} />}
          ListEmptyComponent={
            watches.isPending ? (
              <RowSkeleton rows={4} />
            ) : watches.isError ? (
              <EmptyState title="Couldn’t load your watchlist" body={errorText(watches.error)} action={{ label: 'Try again', onPress: () => watches.refetch() }} />
            ) : (
              <EmptyState
                title="Nothing watched yet"
                body="Open any game and tap Watch price. We’ll check it every few minutes and tell you when it’s worth buying."
                action={{ label: 'Browse deals', onPress: () => router.push('/') }}
              />
            )
          }
        />
      ) : (
        <FlashList
          key="alerts"
          data={activity.data ?? []}
          keyExtractor={(a) => String(a.id)}
          renderItem={renderAlert}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={activity.isRefetching} onRefresh={() => void activity.refetch()} tintColor={c.subtle} />}
          ListEmptyComponent={
            activity.isPending ? (
              <RowSkeleton rows={4} />
            ) : activity.isError ? (
              <EmptyState title="Couldn’t load your alerts" body={errorText(activity.error)} action={{ label: 'Try again', onPress: () => activity.refetch() }} />
            ) : (
              <EmptyState title="No alerts yet" body="When a game you watch goes on sale, hits a new low or a sale is about to end, it shows up here too." />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: GUTTER, paddingVertical: space.md },
  alert: { flexDirection: 'row', gap: space.md, paddingHorizontal: GUTTER, paddingVertical: space.md },
  note: { paddingHorizontal: GUTTER, paddingTop: space.md, minHeight: 44 },
  alertIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
