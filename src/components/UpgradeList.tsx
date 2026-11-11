import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { ApiUpgrade } from '@shared/api';
import { withoutEdition } from '@shared/listing';
import { titleKey } from '@shared/match';
import { errorText } from '../api/client';
import { useDataMode, usePrefs, useUpgrades } from '../hooks/queries';
import { upgradeSummary } from '../lib/upgrades';
import { GUTTER, space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { Cover, EmptyState, RowSkeleton, Tap } from './ui';

/** Rows and the two section headings, in one list */
type Entry = { kind: 'heading'; title: string; count: number } | { kind: 'row'; item: ApiUpgrade };

/**
 * One Switch 2 Edition and the cheapest way to get it (bought whole, or the Switch game
 * plus its upgrade pack from one eShop). The rest (the other way, your own eShop, the
 * price if you already own the game) is on its game page.
 */
const UpgradeRow = memo(function UpgradeRow({ item, currency }: { item: ApiUpgrade; currency: string }) {
  const title = withoutEdition(item.edition.title);
  const s = upgradeSummary(item, currency, title);
  return (
    <Tap
      onPress={() => router.push({ pathname: '/game/[key]', params: { key: item.edition.key } })}
      accessibilityRole="button"
      accessibilityLabel={s.label}
      scaleTo={0.985}
      style={styles.row}
    >
      <Cover uri={item.edition.image} title={item.edition.title} platform="switch2" width={84} height={48} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" tone="muted" numberOfLines={3}>
          {s.cheapest}
        </Text>
      </View>
      <View style={styles.verdict}>
        <Text variant="priceS" tone={s.verdict.tone} numberOfLines={1}>
          {s.verdict.text}
        </Text>
        {s.verdict.detail ? (
          <Text variant="priceXS" tone="subtle" numberOfLines={1}>
            {s.verdict.detail}
          </Text>
        ) : null}
      </View>
    </Tap>
  );
});

export function UpgradeList({ search, header }: { search: string; header?: React.ReactElement }) {
  const { c } = useTheme();
  const mode = useDataMode();
  const { currency } = usePrefs();
  const q = useUpgrades();
  const term = titleKey(search.trim());
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => !term || titleKey(i.edition.title).includes(term) || titleKey(i.base.title).includes(term)), [q.data, term]);
  // Where the upgrade route is the cheapest way first; then the rest, where buying the Edition whole is
  const entries = useMemo<Entry[]>(() => {
    const wins = items.filter((i) => (i.saving ?? -1) >= 0.01);
    const rest = items.filter((i) => !wins.includes(i));
    return [
      ...(wins.length ? [{ kind: 'heading' as const, title: 'Cheaper with the upgrade', count: wins.length }, ...wins.map((item) => ({ kind: 'row' as const, item }))] : []),
      ...(rest.length ? [{ kind: 'heading' as const, title: 'Cheaper to buy the Edition', count: rest.length }, ...rest.map((item) => ({ kind: 'row' as const, item }))] : []),
    ];
  }, [items]);
  const renderItem = useCallback(
    ({ item }: { item: Entry }) =>
      item.kind === 'heading' ? (
        <Text variant="overline" tone="subtle" style={styles.heading} accessibilityRole="header">
          {item.title} · {item.count}
        </Text>
      ) : (
        <UpgradeRow item={item.item} currency={currency} />
      ),
    [currency],
  );

  return (
    <FlashList
      data={entries}
      keyExtractor={(e) => (e.kind === 'heading' ? `h:${e.title}` : e.item.edition.key)}
      getItemType={(e) => e.kind}
      renderItem={renderItem}
      ListHeaderComponent={
        <>
          {header}
          {entries.length ? (
            <Text variant="caption" tone="subtle" style={styles.note}>
              The cheapest way to each Switch 2 Edition across your regions: bought whole, or as the Switch game plus its upgrade pack from one eShop. Open a game for the other way and the price if you already own it.
            </Text>
          ) : null}
        </>
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        mode === 'direct' ? (
          <EmptyState title="Needs your Gamely server" body="Matching upgrade packs to their games happens on your PC. This list comes back when the app can reach it." />
        ) : q.isPending ? (
          <RowSkeleton rows={5} />
        ) : q.isError ? (
          <EmptyState title="Couldn’t load upgrade packs" body={errorText(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
        ) : term ? (
          <EmptyState title="No upgrade pack found" body={`None of the games with an upgrade pack match "${search.trim()}".`} />
        ) : (
          <EmptyState title="No upgrade packs yet" body="They show up here once your server has read the European and Southeast Asian catalogs and priced them." />
        )
      }
      ListFooterComponent={<View style={{ height: space.xxl }} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.subtle} />}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: space.md,
  },
  verdict: { alignItems: 'flex-end', gap: 2, maxWidth: '30%' },
  heading: { paddingHorizontal: GUTTER, paddingTop: space.xl, paddingBottom: space.xs },
  note: {
    paddingHorizontal: GUTTER,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
});
