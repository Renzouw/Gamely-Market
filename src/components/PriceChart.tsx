import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import type { HistoryPoint } from '@shared/api';
import { formatMoney } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import { shortDate } from '../lib/format';
import { space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { haptic } from './ui';

const H = 132;
const PAD_Y = 10;

export function chartGeometry(points: HistoryPoint[], width: number, height = H) {
  if (points.length < 2 || width <= 0) return undefined;
  const vals = points.map((p) => p.best);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0 || 1;
  const vspan = max - min || 1;
  const xy = points.map((p) => ({ x: ((p.t - t0) / span) * width, y: PAD_Y + (1 - (p.best - min) / vspan) * (height - PAD_Y * 2) }));
  // A step line: prices hold until a store changes them
  let line = `M0,${xy[0].y.toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) line += ` H${xy[i].x.toFixed(1)} V${xy[i].y.toFixed(1)}`;
  const area = `${line} V${height} H0 Z`;
  const lowIdx = vals.lastIndexOf(min);
  return { xy, line, area, min, max, lowIdx };
}

/**
 * Daily best price. Drag across it to read any day. Converted at today's
 * exchange rates so the line only moves when a store price moves.
 */
export function PriceChart({ points, currency }: { points: HistoryPoint[]; currency: string }) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | undefined>();
  const geo = useMemo(() => chartGeometry(points, w), [points, w]);
  const lastIdx = useRef<number | undefined>(undefined);

  // Plain touch-responder handlers: they run on events, never during render
  const pick = (x: number) => {
    if (!geo) return;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i].x - x) < Math.abs(geo.xy[best].x - x)) best = i;
    if (best !== lastIdx.current) {
      lastIdx.current = best;
      haptic();
      setActive(best);
    }
  };
  const release = () => {
    lastIdx.current = undefined;
    setActive(undefined);
  };
  // Only take over the touch once the finger moves sideways, so a vertical
  // swipe that starts on the chart still scrolls the page.
  const start = useRef({ x: 0, y: 0 });
  const touch = {
    onTouchStart: (e: GestureResponderEvent) => {
      start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onStartShouldSetResponder: () => false,
    onMoveShouldSetResponder: (e: GestureResponderEvent) => {
      const dx = Math.abs(e.nativeEvent.pageX - start.current.x);
      const dy = Math.abs(e.nativeEvent.pageY - start.current.y);
      return dx > 6 && dx > dy;
    },
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => pick(e.nativeEvent.locationX),
    onResponderMove: (e: GestureResponderEvent) => pick(e.nativeEvent.locationX),
    onResponderRelease: release,
    onResponderTerminate: release,
  };

  if (points.length < 2) {
    return (
      <Text variant="footnote" tone="subtle">
        We started tracking this game recently. The chart fills in as prices change.
      </Text>
    );
  }

  const shown = active !== undefined ? points[active] : points[points.length - 1];
  const low = geo ? points[geo.lowIdx] : undefined;

  return (
    <View>
      <View style={styles.readout}>
        <Text variant="priceL">{formatMoney(shown.best, currency)}</Text>
        <Text variant="footnote" tone="muted">
          {active !== undefined ? `${shortDate(shown.t)} · ${regionLabel(shown.country).name}` : 'Today'}
        </Text>
      </View>
      <View
        {...touch}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        style={{ height: H }}
        accessible
        accessibilityLabel={`Price history. Lowest ${low ? formatMoney(low.best, currency) : ''} on ${low ? shortDate(low.t) : ''}. Today ${formatMoney(points[points.length - 1].best, currency)}.`}
      >
        {geo ? (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.signal} stopOpacity={0.22} />
                <Stop offset="1" stopColor={c.signal} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={geo.area} fill="url(#fill)" />
            <Path d={geo.line} stroke={c.signalText} strokeWidth={2} fill="none" strokeLinejoin="round" />
            <Circle cx={geo.xy[geo.lowIdx].x} cy={geo.xy[geo.lowIdx].y} r={4} fill={c.signalText} stroke={c.bg} strokeWidth={2} />
            {active !== undefined ? (
              <>
                <Line x1={geo.xy[active].x} x2={geo.xy[active].x} y1={0} y2={H} stroke={c.muted} strokeWidth={1} strokeDasharray="3,3" />
                <Circle cx={geo.xy[active].x} cy={geo.xy[active].y} r={5} fill={c.text} />
              </>
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <Text variant="caption" tone="subtle">
          {shortDate(points[0].t)}
        </Text>
        {low ? (
          <Text variant="caption" tone="signal">
            Low {formatMoney(low.best, currency)} · {shortDate(low.t)}
          </Text>
        ) : null}
        <Text variant="caption" tone="subtle">
          Today
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.sm },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
});
