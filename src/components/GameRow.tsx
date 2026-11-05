import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { endsSoon, formatMoney, timeLeft } from '../domain/pricing';
import { regionLabel } from '../domain/regions';
import type { Game, RegionPrice } from '../domain/types';
import { usePriceSummary } from '../hooks/usePriceSummary';
import { radius, space, useTheme } from '../theme';
import { DiscountBadge, Pill, PlatformTag } from './ui';

interface Props {
  game: Game;
  prices: RegionPrice[];
  /** Show a strip of the cheapest regions under the row (directory view) */
  showRegions?: boolean;
  showPlatform?: boolean;
}

function GameRowInner({ game, prices, showRegions, showPlatform }: Props) {
  const { c } = useTheme();
  const s = usePriceSummary(game, prices);
  const best = s.best;
  const bestRegion = best ? regionLabel(best.country) : undefined;
  const isHomeBest = best && s.home && best.country === s.home.country;
  const ends = best?.saleEndsAt ?? s.home?.saleEndsAt;
  const left = timeLeft(ends);
  const maxDiscount = Math.max(0, ...prices.map((p) => p.discountPercent));
  const foreign = best && best.current.currency !== s.homeCurrency;
  const pricingKnown = prices.length > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${game.title}${best?.converted !== undefined ? `, best price ${formatMoney(best.converted, s.homeCurrency)}` : ''}`}
      onPress={() => router.push({ pathname: '/game/[key]', params: { key: game.key } })}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surface2 : 'transparent' }]}
    >
      <View style={styles.top}>
        <Image source={game.image} style={[styles.thumb, { backgroundColor: c.surface2 }]} contentFit="cover" transition={150} recyclingKey={game.key} />
        <View style={styles.body}>
          <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
            {game.title}
          </Text>
          <View style={styles.meta}>
            {maxDiscount > 0 ? <DiscountBadge percent={best?.discountPercent || maxDiscount} /> : null}
            {showPlatform ? <PlatformTag platform={game.platform} /> : null}
            {left ? <Pill text={left} icon="time-outline" tone={endsSoon(ends) ? 'warn' : 'neutral'} /> : null}
          </View>

          {best && best.converted !== undefined ? (
            <View style={styles.priceLine}>
              <Text style={[styles.price, { color: c.text }]}>
                {foreign ? '≈' : ''}
                {formatMoney(best.converted, s.homeCurrency)}
              </Text>
              {best.convertedRegular !== undefined && best.sale ? (
                <Text style={[styles.strike, { color: c.textFaint }]}>{formatMoney(best.convertedRegular, s.homeCurrency)}</Text>
              ) : null}
            </View>
          ) : pricingKnown ? (
            <Text style={[styles.sub, { color: c.textDim }]}>Loading exchange rates…</Text>
          ) : (
            <Text style={[styles.sub, { color: c.textFaint }]}>No price in your regions</Text>
          )}

          {best && bestRegion && game.platform !== 'steam' ? (
            <Text numberOfLines={1} style={[styles.sub, { color: c.textDim }]}>
              {isHomeBest ? (
                'Cheapest in your eShop'
              ) : (
                <>
                  {bestRegion.flag} {bestRegion.name}
                  {s.savingVsHome && s.savingVsHome >= 0.01 ? (
                    <Text style={{ color: c.good, fontWeight: '700' }}> · {Math.round(s.savingVsHome * 100)}% less than home</Text>
                  ) : null}
                </>
              )}
            </Text>
          ) : null}
        </View>
      </View>

      {showRegions && s.ranked.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {s.ranked.slice(0, 8).map((p, i) => {
            const r = regionLabel(p.country);
            const home = p.country === s.home?.country;
            return (
              <View
                key={p.country}
                style={[
                  styles.regionChip,
                  { backgroundColor: i === 0 ? c.goodBg : c.surface2, borderColor: home ? c.accent : 'transparent' },
                ]}
              >
                <Text style={[styles.regionText, { color: i === 0 ? c.good : c.text }]}>
                  {r.flag} {formatMoney(p.current.amount, p.current.currency)}
                </Text>
                {p.current.currency !== s.homeCurrency && p.converted !== undefined ? (
                  <Text style={[styles.regionConv, { color: c.textDim }]}>≈{formatMoney(p.converted, s.homeCurrency)}</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </Pressable>
  );
}

export const GameRow = memo(GameRowInner);

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.lg, paddingVertical: space.md },
  top: { flexDirection: 'row', gap: space.md },
  thumb: { width: 128, height: 72, borderRadius: radius.md },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  price: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  strike: { fontSize: 13, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12.5 },
  strip: { gap: 6, paddingTop: space.sm },
  regionChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1 },
  regionText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  regionConv: { fontSize: 10.5, fontVariant: ['tabular-nums'] },
});
