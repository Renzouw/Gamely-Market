import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { ApiUpgrade, ApiUpgradeCountry } from '@shared/api';
import { withoutEdition } from '@shared/listing';
import { titleKey } from '@shared/match';
import { formatMoney, formatWhole } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import { errorText } from '../api/client';
import { useDataMode, usePrefs, useUpgrades } from '../hooks/queries';
import { GUTTER, space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { Cover, EmptyState, RowSkeleton, Tap } from './ui';

/** Whole amounts from 100 up ("₱3,490", not "₱3,490.00"): long prices made the rows wrap and cut off */
const fmt = (n: number, currency: string) => (Math.abs(n) >= 100 ? formatWhole(n, currency) : formatMoney(n, currency));

/** The trick in the caller's own eShop, against the Edition there: "In your eShop 🇵🇭: ₱3,490 + ₱390 = ₱3,880, same price" */
export function homeLineText(home: ApiUpgradeCountry, currency: string): string {
  const r = regionLabel(home.country);
  const c = home.converted;
  const money = (mine: number | undefined, local: number) => (c && mine !== undefined ? fmt(mine, currency) : fmt(local, home.currency));
  const saving = c?.saving;
  const verdict = saving === undefined ? '' : saving >= 0.01 ? `, saves ${fmt(saving, currency)}` : saving <= -0.01 ? `, ${fmt(-saving, currency)} more` : ', same price';
  return `In your eShop ${r.flag}: ${money(c?.base, home.base)} + ${money(c?.pack, home.pack)} = ${money(c?.combo, home.base + home.pack)}${verdict}`;
}

function HomeLine({ home, currency }: { home: ApiUpgradeCountry; currency: string }) {
  const saving = home.converted?.saving;
  return (
    <Text variant="footnote" tone={saving !== undefined && saving >= 0.01 ? 'signal' : 'subtle'} numberOfLines={2}>
      {homeLineText(home, currency)}
    </Text>
  );
}

/**
 * Switch 2 Editions next to the "Switch game + upgrade pack" route, in the
 * country where that route saves the most. An upgrade pack only works with
 * a game from the same eShop, so each comparison stays within one country.
 */
const UpgradeRow = memo(function UpgradeRow({ item, currency }: { item: ApiUpgrade; currency: string }) {
  const b = item.best;
  const home = item.home;
  const c = b?.converted;
  // In the caller's currency when there's a rate, otherwise in the country's own
  const money = (mine: number | undefined, local: number) => (c && mine !== undefined ? fmt(mine, currency) : fmt(local, b!.currency));
  const where = b ? regionLabel(b.country) : undefined;
  const title = withoutEdition(item.edition.title);
  const saving = c?.saving;

  let verdict: { text: string; tone: 'signal' | 'subtle' | 'muted' };
  if (saving !== undefined && saving >= 0.01) verdict = { text: `Save ${fmt(saving, currency)}`, tone: 'signal' };
  else if (saving !== undefined) verdict = { text: 'No saving', tone: 'subtle' };
  else verdict = { text: 'Only as upgrade', tone: 'muted' };

  return (
    <Tap
      onPress={() =>
        router.push({
          pathname: '/game/[key]',
          params: { key: item.edition.key },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={
        b
          ? `${title}. Switch game ${money(c?.base, b.base)} plus upgrade ${money(c?.pack, b.pack)} is ${money(c?.combo, b.base + b.pack)}${
              b.edition !== undefined ? `, against ${money(c?.edition, b.edition)} for the Switch 2 Edition` : ''
            }, in ${where!.name}. ${verdict.text}.${home && home.country !== b.country ? ` ${homeLineText(home, currency)}.` : ''}`
          : `${title}. ${verdict.text}.`
      }
      scaleTo={0.985}
      style={styles.row}
    >
      <Cover uri={item.edition.image} title={item.edition.title} platform="switch2" width={84} height={48} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {title}
        </Text>
        {b ? (
          <>
            <Text variant="footnote" tone="muted" numberOfLines={2}>
              Switch game {money(c?.base, b.base)}
              {b.baseSale ? ' (sale)' : ''} + upgrade {money(c?.pack, b.pack)}
              {b.packSale ? ' (sale)' : ''} = <Text variant="footnote">{money(c?.combo, b.base + b.pack)}</Text>
            </Text>
            <Text variant="footnote" tone="subtle" numberOfLines={1}>
              {b.edition !== undefined ? `Switch 2 Edition ${money(c?.edition, b.edition)}${b.editionSale ? ' (sale)' : ''}` : 'The Edition isn’t sold whole here'}
            </Text>
          </>
        ) : null}
        {home && home.country !== b?.country ? <HomeLine home={home} currency={currency} /> : null}
      </View>
      <View style={styles.verdict}>
        <Text variant="priceS" tone={verdict.tone} numberOfLines={1}>
          {verdict.text}
        </Text>
        {saving !== undefined && saving >= 0.01 && c?.edition ? (
          <Text variant="priceXS" tone="subtle">
            −{Math.round((saving / c.edition) * 100)}%
          </Text>
        ) : null}
        {where ? (
          <Text variant="priceXS" tone="subtle" numberOfLines={1}>
            in {where.flag} {b!.country}
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
  const renderItem = useCallback(({ item }: { item: ApiUpgrade }) => <UpgradeRow item={item} currency={currency} />, [currency]);

  return (
    <FlashList
      data={items}
      keyExtractor={(i) => i.edition.key}
      renderItem={renderItem}
      ListHeaderComponent={
        <>
          {header}
          {items.length ? (
            <Text variant="caption" tone="subtle" style={styles.note}>
              An upgrade pack turns the Switch game into its Switch 2 Edition. Both have to come from the same eShop, so each line compares prices in one country.
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
  note: {
    paddingHorizontal: GUTTER,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
});
