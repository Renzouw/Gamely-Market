import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { ConvertedRegionPrice } from '@shared/types';
import { formatMoney } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import { space, useTheme } from '../theme';
import { Text } from '../theme/Text';

/**
 * Every region on one line, cheapest on the left. One glance answers
 * "is it worth buying abroad?": a tight cluster means no, a long tail means yes.
 */
export function PriceSpread({ ranked, homeCountry, currency }: { ranked: ConvertedRegionPrice[]; homeCountry?: string; currency: string }) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const pts = ranked.filter((p) => p.converted !== undefined);
  if (pts.length < 2) return null;
  const min = pts[0].converted!;
  const max = pts[pts.length - 1].converted!;
  const span = max - min || 1;
  const x = (v: number) => 6 + ((v - min) / span) * Math.max(0, w - 12);
  const home = pts.find((p) => p.country === homeCountry);

  return (
    <View
      accessible
      accessibilityLabel={`Prices range from ${formatMoney(min, currency)} in ${regionLabel(pts[0].country).name} to ${formatMoney(max, currency)} in ${regionLabel(pts[pts.length - 1].country).name}`}
      style={styles.wrap}
    >
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
        <View style={[styles.line, { backgroundColor: c.line }]} />
        {w > 0
          ? pts.map((p, i) => {
              const isHome = p.country === homeCountry;
              const isBest = i === 0;
              return (
                <View
                  key={p.country}
                  style={[
                    styles.dot,
                    {
                      left: x(p.converted!) - (isBest || isHome ? 6 : 4),
                      width: isBest || isHome ? 12 : 8,
                      height: isBest || isHome ? 12 : 8,
                      borderRadius: 6,
                      // signalText is lime in dark mode and a dark green in light mode, so the marker stays visible
                      backgroundColor: isBest ? c.signalText : isHome ? c.bg : c.subtle,
                      borderWidth: isHome && !isBest ? 2 : 0,
                      borderColor: c.text,
                      top: isBest || isHome ? 5 : 7,
                      opacity: isBest || isHome ? 1 : 0.7,
                    },
                  ]}
                />
              );
            })
          : null}
      </View>
      <View style={styles.labels}>
        <Text variant="priceXS" tone="signal">
          {pts[0].country} {formatMoney(min, currency)}
        </Text>
        {home && home !== pts[0] && home !== pts[pts.length - 1] ? (
          <Text variant="priceXS" tone="text">
            You {formatMoney(home.converted, currency)}
          </Text>
        ) : null}
        <Text variant="priceXS" tone="subtle">
          {pts[pts.length - 1].country} {formatMoney(max, currency)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  track: { height: 22, justifyContent: 'center' },
  line: { height: 2, borderRadius: 1 },
  dot: { position: 'absolute' },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
});
