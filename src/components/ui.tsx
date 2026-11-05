import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform as RNPlatform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { Platform } from '../domain/types';
import { platformMeta, radius, space, useTheme } from '../theme';

export function tap() {
  if (RNPlatform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  color,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
}) {
  const { c } = useTheme();
  const tint = color ?? c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? tint : c.surface2,
          borderColor: active ? tint : c.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? '#fff' : c.textDim} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.chipText, { color: active ? '#fff' : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, style]}>
      {children}
    </ScrollView>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: c.surface2, borderColor: c.border }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.segmentItem, active && { backgroundColor: c.surface, borderColor: o.color ?? c.accent }]}
          >
            {o.color ? <View style={[styles.dot, { backgroundColor: o.color }]} /> : null}
            <Text style={[styles.segmentText, { color: active ? c.text : c.textDim }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DiscountBadge({ percent, large }: { percent: number; large?: boolean }) {
  const { c, dark } = useTheme();
  if (!percent) return null;
  return (
    <View style={[styles.badge, { backgroundColor: c.good }, large && { paddingHorizontal: 8, paddingVertical: 3 }]}>
      <Text style={[styles.badgeText, { color: dark ? '#06281A' : '#FFFFFF' }, large && { fontSize: 14 }]}>−{percent}%</Text>
    </View>
  );
}

export function PlatformTag({ platform }: { platform: Platform }) {
  const meta = platformMeta[platform];
  return (
    <View style={[styles.badge, { backgroundColor: meta.color + '26', borderWidth: 1, borderColor: meta.color + '66' }]}>
      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'neutral', icon }: { text: string; tone?: 'neutral' | 'warn' | 'good'; icon?: keyof typeof Ionicons.glyphMap }) {
  const { c } = useTheme();
  const bg = tone === 'warn' ? c.warnBg : tone === 'good' ? c.goodBg : c.surface2;
  const fg = tone === 'warn' ? c.warn : tone === 'good' ? c.good : c.textDim;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={fg} style={{ marginRight: 3 }} /> : null}
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Skeleton({ height, width, style }: { height: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const { c } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, width: width ?? '100%', backgroundColor: c.skeleton, borderRadius: radius.sm, opacity: pulse }, style]} />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ padding: space.lg, gap: space.lg }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
          <Skeleton height={68} width={120} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="85%" />
            <Skeleton height={12} width="40%" />
            <Skeleton height={18} width="55%" />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={c.textFaint} />
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: c.textDim }]}>{body}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: c.textDim }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
}) {
  const { c } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? c.accent : c.surface2, borderColor: c.border, borderWidth: primary ? 0 : 1, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={primary ? '#fff' : c.text} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.buttonText, { color: primary ? '#fff' : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipRow: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  segment: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 3 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm, flex: 1 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: space.sm },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
});
