import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform as RNPlatform,
  Pressable,
  StyleSheet,
  Switch as RNSwitch,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Platform } from '@shared/types';
import { initials } from '../lib/format';
import { GUTTER, HIT, platformMeta, radius, space, useTheme } from '../theme';
import { Text } from '../theme/Text';

export function haptic(kind: 'select' | 'success' | 'light' = 'select') {
  if (RNPlatform.OS === 'web') return;
  if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  else if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  else Haptics.selectionAsync().catch(() => undefined);
}

/** Pressable that settles slightly under the finger, like native controls do. */
export function Tap({ style, children, scaleTo = 0.975, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode; scaleTo?: number }) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: RNPlatform.OS !== 'web', speed: 40, bounciness: 0 }).start();
  return (
    <Pressable {...rest} onPressIn={(e) => (to(scaleTo), rest.onPressIn?.(e))} onPressOut={(e) => (to(1), rest.onPressOut?.(e))}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'quiet';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const bg = variant === 'primary' ? c.signal : variant === 'secondary' ? c.raised : 'transparent';
  const fg = variant === 'primary' ? c.signalInk : c.text;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: !!loading, disabled: !!loading }}
      disabled={loading}
      onPress={() => (haptic('light'), onPress())}
      style={[styles.button, { backgroundColor: bg }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text variant="headline" style={{ color: fg }}>
        {label}
      </Text>
    </Tap>
  );
}

/** Text-only filter toggle. Selected state is an inverted fill, never a colour. */
export function Chip({ label, active, onPress, trailing }: { label: string; active?: boolean; onPress: () => void; trailing?: keyof typeof Ionicons.glyphMap }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={() => (haptic(), onPress())}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? c.invert : 'transparent', borderColor: active ? c.invert : c.line, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text variant="footnoteMedium" style={{ color: active ? c.invertText : c.text }}>
        {label}
      </Text>
      {trailing ? <Ionicons name={trailing} size={13} color={active ? c.invertText : c.muted} style={{ marginLeft: 4 }} /> : null}
    </Pressable>
  );
}

/** Platform tabs: words with an underline, no pills. */
export function PlatformTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; dot?: string }[]; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.tabs, { borderBottomColor: c.line }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => (haptic(), onChange(o.value))} style={styles.tab}>
            <View style={styles.tabLabel}>
              {o.dot ? <View style={[styles.dot, { backgroundColor: o.dot, opacity: on ? 1 : 0.45 }]} /> : null}
              <Text variant="headline" tone={on ? 'text' : 'subtle'}>
                {o.label}
              </Text>
            </View>
            <View style={[styles.tabBar, { backgroundColor: on ? c.text : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function PlatformLabel({ platform }: { platform: Platform }) {
  const m = platformMeta[platform];
  return (
    <View style={styles.platform}>
      <View style={[styles.dot, { backgroundColor: m.dot }]} />
      <Text variant="caption" tone="muted">
        {m.label}
      </Text>
    </View>
  );
}

/** Cover art, or a tinted tile with the game's initials when there isn't any. */
export const Cover = memo(function Cover({
  uri,
  title,
  platform,
  width,
  height,
  rounded = radius.md,
}: {
  uri?: string;
  title: string;
  platform: Platform;
  width: number | `${number}%`;
  height: number;
  rounded?: number;
}) {
  const { c } = useTheme();
  const tint = platformMeta[platform].dot;
  return (
    <View style={{ width, height, borderRadius: rounded, overflow: 'hidden', backgroundColor: c.raised }}>
      <View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
        <Text variant={height > 120 ? 'largeTitle' : 'headline'} tone="subtle">
          {initials(title)}
        </Text>
        <View style={[styles.coverStripe, { backgroundColor: tint }]} />
      </View>
      {uri ? <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} cachePolicy="memory-disk" recyclingKey={uri} /> : null}
    </View>
  );
});

/** Every skeleton on screen pulses together off one shared animation, started by the first and stopped by the last. */
const pulse = new Animated.Value(0.55);
let pulseUsers = 0;
let pulseLoop: Animated.CompositeAnimation | undefined;
function usePulse() {
  useEffect(() => {
    if (pulseUsers++ === 0) {
      const native = RNPlatform.OS !== 'web';
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: native }),
          Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: native }),
        ]),
      );
      pulseLoop.start();
    }
    return () => {
      if (--pulseUsers === 0) pulseLoop?.stop();
    };
  }, []);
  return pulse;
}

export function Skeleton({ height, width, style, rounded = radius.sm }: { height: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle>; rounded?: number }) {
  const { c } = useTheme();
  const pulse = usePulse();
  return <Animated.View style={[{ height, width: width ?? '100%', backgroundColor: c.skeleton, borderRadius: rounded, opacity: pulse }, style]} />;
}

export function RowSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ paddingHorizontal: GUTTER, paddingTop: space.sm }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md }}>
          <Skeleton height={60} width={106} rounded={radius.md} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <Skeleton height={13} width="80%" />
            <Skeleton height={11} width="35%" />
          </View>
          <View style={{ width: 70, gap: 8, alignItems: 'flex-end', paddingTop: 4 }}>
            <Skeleton height={16} width={64} />
            <Skeleton height={11} width={40} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.empty}>
      <Text variant="title" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" style={{ marginTop: space.md, alignSelf: 'center', paddingHorizontal: space.xl }} /> : null}
    </View>
  );
}

/* --------------------------- grouped list rows --------------------------- */

export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: space.xxl, paddingHorizontal: GUTTER }}>
      {title ? (
        <Text variant="overline" tone="subtle" style={{ marginBottom: space.sm, marginLeft: space.xs }}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: c.surface }]}>{children}</View>
      {footer ? (
        <Text variant="footnote" tone="subtle" style={{ marginTop: space.sm, marginHorizontal: space.xs }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function Row({
  label,
  detail,
  value,
  onPress,
  right,
  first,
  icon,
  accessibilityHint,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  first?: boolean;
  icon?: ReactNode;
  accessibilityHint?: string;
}) {
  const { c } = useTheme();
  const body = (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {detail ? (
          <Text variant="footnote" tone="subtle">
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="muted" numberOfLines={1} style={{ maxWidth: '55%' }}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={16} color={c.subtle} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : 'transparent' })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function SwitchRow({ label, detail, value, onChange, first, disabled }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; first?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Row
      first={first}
      label={label}
      detail={detail}
      right={
        <RNSwitch
          value={value}
          disabled={disabled}
          onValueChange={(v) => (haptic(), onChange(v))}
          trackColor={{ true: c.signal, false: c.line }}
          thumbColor={RNPlatform.OS === 'ios' ? undefined : value ? c.signalInk : '#FFFFFF'}
          {...(RNPlatform.OS === 'web' ? { activeThumbColor: c.signalInk } : {})}
          ios_backgroundColor={c.line}
          accessibilityLabel={label}
        />
      }
    />
  );
}

/** Bottom sheet with a list of choices. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space.md }]}>
        <View style={[styles.grabber, { backgroundColor: c.line }]} />
        <Text variant="headline" style={{ paddingHorizontal: GUTTER, paddingVertical: space.md }}>
          {title}
        </Text>
        {children}
      </View>
    </Modal>
  );
}

export function SheetOption({ label, detail, selected, onPress }: { label: string; detail?: string; selected?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => (haptic(), onPress())}
      style={({ pressed }) => [styles.sheetOption, { backgroundColor: pressed ? c.raised : 'transparent' }]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {detail ? (
          <Text variant="footnote" tone="subtle">
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={20} color={c.text} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { height: 50, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: GUTTER - space.sm },
  tab: { minHeight: HIT, paddingHorizontal: space.sm, justifyContent: 'flex-end', marginRight: space.sm },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10 },
  tabBar: { height: 2, borderRadius: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  platform: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverStripe: { position: 'absolute', left: 0, bottom: 0, width: '100%', height: 2, opacity: 0.8 },
  empty: { alignItems: 'center', paddingHorizontal: space.xxl, paddingVertical: 64, gap: space.sm },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(15,15,14,0.55)', alignItems: 'center', justifyContent: 'center' },
  sheetOption: { minHeight: 52, paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center' },
});

/** Back button that stays readable over cover art and over scrolled content. */
export function BackButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name="chevron-back" size={22} color="#FFFFFF" style={{ marginLeft: -2 }} />
    </Pressable>
  );
}
