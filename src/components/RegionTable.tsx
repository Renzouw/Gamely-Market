import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../domain/pricing';
import { regionLabel, switchRegion } from '../domain/regions';
import type { ConvertedRegionPrice } from '../domain/types';
import { radius, space, useTheme } from '../theme';
import { DiscountBadge } from './ui';

interface Props {
  ranked: ConvertedRegionPrice[];
  homeCountry?: string;
  homeCurrency: string;
  /** Collapse to this many rows with a "show all" toggle */
  initialRows?: number;
}

/**
 * Every region, cheapest first. The bar shows how each price compares to
 * the most expensive region, so the spread is obvious at a glance.
 */
export function RegionTable({ ranked, homeCountry, homeCurrency, initialRows = 8 }: Props) {
  const { c } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? ranked : ranked.slice(0, initialRows);
  const max = Math.max(...ranked.map((p) => p.converted ?? 0), 0.01);

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {rows.map((p, i) => {
        const r = regionLabel(p.country);
        const note = switchRegion(p.country)?.note;
        const isHome = p.country === homeCountry;
        const isBest = i === 0 && p.converted !== undefined;
        const pct = p.converted !== undefined ? Math.max(4, (p.converted / max) * 100) : 0;
        return (
          <View
            key={p.country}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
            accessible
            accessibilityLabel={`${r.name}: ${formatMoney(p.current.amount, p.current.currency)}${p.discountPercent ? `, ${p.discountPercent}% off` : ''}${
              p.converted !== undefined ? `, about ${formatMoney(p.converted, homeCurrency)}` : ''
            }${isBest ? ', cheapest' : ''}${isHome ? ', your region' : ''}`}
          >
            <Text style={styles.flag}>{r.flag}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.nameLine}>
                <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
                  {r.name}
                </Text>
                {isHome ? <Text style={[styles.tag, { color: c.accent, borderColor: c.accent }]}>HOME</Text> : null}
                {isBest ? <Text style={[styles.tag, { color: c.good, borderColor: c.good }]}>BEST</Text> : null}
              </View>
              <View style={[styles.barTrack, { backgroundColor: c.surface2 }]}>
                <View style={[styles.bar, { width: `${pct}%`, backgroundColor: isBest ? c.good : isHome ? c.accent : c.textFaint }]} />
              </View>
              <Text style={[styles.local, { color: c.textDim }]} numberOfLines={1}>
                {formatMoney(p.current.amount, p.current.currency)}
                {p.sale ? ' ' : ''}
                {p.sale ? <Text style={{ textDecorationLine: 'line-through', color: c.textFaint }}>{formatMoney(p.regular.amount, p.regular.currency)}</Text> : null}
              </Text>
              {note ? (
                <Text style={[styles.note, { color: c.warn }]} numberOfLines={1}>
                  <Ionicons name="card-outline" size={11} color={c.warn} /> {note}
                </Text>
              ) : null}
            </View>
            <View style={styles.right}>
              <Text style={[styles.converted, { color: isBest ? c.good : c.text }]}>
                {p.converted !== undefined ? formatMoney(p.converted, homeCurrency) : '–'}
              </Text>
              <DiscountBadge percent={p.discountPercent} />
            </View>
          </View>
        );
      })}
      {ranked.length > initialRows ? (
        <Pressable onPress={() => setExpanded((e) => !e)} style={[styles.more, { borderTopColor: c.border }]}>
          <Text style={{ color: c.accent, fontWeight: '700' }}>{expanded ? 'Show fewer' : `Show all ${ranked.length} regions`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  flag: { fontSize: 24 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  tag: { fontSize: 9.5, fontWeight: '800', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  barTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  local: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  note: { fontSize: 11 },
  right: { alignItems: 'flex-end', gap: 4, minWidth: 84 },
  converted: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  more: { alignItems: 'center', paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
