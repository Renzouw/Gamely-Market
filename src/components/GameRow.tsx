import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import type { ApiGame, ApiPrice } from '@shared/api';
import { KIND_LABEL, listingKind } from '@shared/listing';
import { endsSoon, formatMoney, timeLeft } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import { usePriceSummary } from '../hooks/queries';
import { GUTTER, platformMeta, space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { Cover, PlatformLabel, Tap } from './ui';

const COVER_W = 106;
const COVER_H = 60;

interface Props {
  game: ApiGame;
  prices: ApiPrice[];
  /** A one-line ticker of the cheapest regions (directory) */
  ticker?: boolean;
  showPlatform?: boolean;
}

function GameRowInner({ game, prices, ticker, showPlatform }: Props) {
  const { c } = useTheme();
  // Smaller art on narrow phones (iPhone SE, small Androids) so titles keep room
  const compact = useWindowDimensions().width < 360;
  const coverW = compact ? 84 : COVER_W;
  const s = usePriceSummary(game.platform, prices);
  // On Steam you pay your own store's price, so that's the one to show
  const best = game.platform === 'steam' ? (s.home ?? s.best) : s.best;
  const isSteam = game.platform === 'steam';
  const homeIsBest = best && s.home && best.country === s.home.country;
  const region = best ? regionLabel(best.country) : undefined;
  const left = endsSoon(best?.saleEndsAt) ? timeLeft(best?.saleEndsAt) : undefined;
  const saving = s.savingVsHome && s.savingVsHome >= 0.05 ? Math.round(s.savingVsHome * 100) : 0;

  const open = useCallback(() => router.push({ pathname: '/game/[key]', params: { key: game.key } }), [game.key]);
  // Upgrade packs and Friend's Passes look like games in a list; say what they are
  const kind = listingKind(game);
  const tag = kind === 'game' ? undefined : KIND_LABEL[kind].tag;
  // A recycled row would keep the last game's sideways scroll: put it back to the start
  const tickerRef = useRef<ScrollViewInstance>(null);
  useEffect(() => tickerRef.current?.scrollTo({ x: 0, animated: false }), [game.key]);

  let context: { text: string; tone: 'warn' | 'signal' | 'subtle' } | undefined;
  if (left) context = { text: `Ends in ${left}`, tone: 'warn' };
  else if (!isSteam && best && !homeIsBest && saving) context = { text: `${region?.flag} ${saving}% cheaper`, tone: 'signal' };
  else if (!isSteam && best && region) context = { text: homeIsBest ? 'Cheapest at home' : `${region.flag} ${region.name}`, tone: 'subtle' };
  else if (game.publisher) context = { text: game.publisher, tone: 'subtle' };

  const label = [
    game.title,
    tag,
    best?.converted !== undefined ? `${formatMoney(best.converted, s.currency)}${region && !isSteam ? ` in ${region.name}` : ''}` : 'No price in your regions',
    best?.discountPercent ? `${best.discountPercent}% off` : undefined,
    showPlatform ? platformMeta[game.platform].label : undefined,
    left ? `ends in ${left}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Tap onPress={open} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.985} style={styles.row}>
      <View style={styles.main}>
        <Cover uri={game.image} title={game.title} platform={game.platform} width={coverW} height={compact ? 48 : COVER_H} />
        <View style={styles.text}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {game.title}
          </Text>
          <View style={styles.meta}>
            {showPlatform ? <PlatformLabel platform={game.platform} dotOnly /> : null}
            {tag ? (
              <Text variant="caption" tone="muted" numberOfLines={1} style={[styles.tag, { borderColor: c.line }]}>
                {tag}
              </Text>
            ) : null}
            {context ? (
              <Text variant="footnote" tone={context.tone} numberOfLines={1} style={{ flexShrink: 1 }}>
                {context.text}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.price}>
          {best?.converted !== undefined ? (
            <>
              <Text variant="priceM" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatMoney(best.converted, s.currency)}
              </Text>
              <View style={styles.priceMeta}>
                {best.discountPercent ? (
                  <Text variant="priceXS" tone="signal">
                    −{best.discountPercent}%
                  </Text>
                ) : null}
                {!isSteam && region && left ? <Text variant="priceXS">{region.flag}</Text> : null}
              </View>
            </>
          ) : (
            <Text variant="footnote" tone="subtle">
              {prices.length ? '…' : 'Not sold'}
            </Text>
          )}
        </View>
      </View>

      {ticker && s.ranked.length > 1 ? (
        <ScrollView ref={tickerRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.ticker, { paddingLeft: coverW + space.md }]} accessible={false}>
          {s.ranked.slice(0, 10).map((p, i) =>
            p.converted === undefined ? null : (
              <View key={p.country} style={styles.tick}>
                <Text variant="priceXS" tone={i === 0 ? 'signal' : 'subtle'}>
                  {p.country}
                </Text>
                <Text variant="priceXS" tone={i === 0 ? 'signal' : p.country === s.home?.country ? 'text' : 'muted'}>
                  {formatMoney(p.converted, s.currency)}
                </Text>
              </View>
            ),
          )}
        </ScrollView>
      ) : null}
      {ticker ? <View style={[styles.rule, { backgroundColor: c.line, left: GUTTER + coverW + space.md }]} /> : null}
    </Tap>
  );
}

export const GameRow = memo(GameRowInner, (a, b) => a.game === b.game && a.prices === b.prices && a.ticker === b.ticker && a.showPlatform === b.showPlatform);

const styles = StyleSheet.create({
  row: { paddingHorizontal: GUTTER, paddingVertical: space.md },
  main: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  price: { alignItems: 'flex-end', minWidth: 72, maxWidth: '36%', gap: 2, flexShrink: 0 },
  priceMeta: { flexDirection: 'row', gap: 6 },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, flexShrink: 0 },
  ticker: { gap: space.lg, paddingTop: space.sm },
  tick: { flexDirection: 'row', gap: 5 },
  rule: { height: StyleSheet.hairlineWidth, position: 'absolute', bottom: 0, right: 0 },
});
