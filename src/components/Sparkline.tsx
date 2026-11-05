import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { PricePoint } from '../domain/types';

export function sparkPath(points: PricePoint[], width: number, height: number, pad = 4): { d: string; last?: { x: number; y: number } } {
  if (points.length < 2 || width <= 0) return { d: '' };
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.best);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spanT = t1 - t0 || 1;
  const spanV = max - min || 1;
  const xy = points.map((p) => ({
    x: pad + ((p.t - t0) / spanT) * (width - pad * 2),
    y: pad + (1 - (p.best - min) / spanV) * (height - pad * 2),
  }));
  // Step line: a price holds until it changes
  let d = `M${xy[0].x.toFixed(1)},${xy[0].y.toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) d += ` H${xy[i].x.toFixed(1)} V${xy[i].y.toFixed(1)}`;
  return { d, last: xy[xy.length - 1] };
}

export function Sparkline({ points, color, height = 56 }: { points: PricePoint[]; color: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const { d, last } = sparkPath(points, width, height);
  return (
    <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {d ? (
        <Svg width={width} height={height}>
          <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {last ? <Circle cx={last.x} cy={last.y} r={3.5} fill={color} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
