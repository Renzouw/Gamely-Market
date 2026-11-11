import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { HIT, radius, space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { haptic } from './ui';

interface ToastState {
  id: number;
  message?: string;
  action?: { label: string; onPress: () => void };
}

const useToast = create<ToastState>(() => ({ id: 0 }));

/** A short note at the bottom of the screen, with an optional action such as Undo. Gone after a few seconds. */
export function showToast(message: string, action?: ToastState['action']) {
  useToast.setState((s) => ({ id: s.id + 1, message, action }));
}

const SHOW_MS = 5000;

export function Toast() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { id, message, action } = useToast();

  useEffect(() => {
    if (!message) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    // Screen reader users get longer to reach Undo, as long as Android's setting asks for
    void AccessibilityInfo.getRecommendedTimeoutMillis(SHOW_MS)
      .catch(() => SHOW_MS)
      .then((ms) => {
        if (!gone) t = setTimeout(() => useToast.setState((s) => (s.id === id ? { message: undefined, action: undefined } : s)), ms);
      });
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [id, message]);

  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 64 }]}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: c.invert }]}>
        <Text variant="callout" style={{ color: c.invertText, flex: 1 }} numberOfLines={2}>
          {message}
        </Text>
        {action ? (
          <Pressable
            onPress={() => {
              haptic('light');
              useToast.setState({ message: undefined, action: undefined });
              action.onPress();
            }}
            accessibilityRole="button"
            style={styles.action}
          >
            <Text variant="headline" style={{ color: c.invertText, textDecorationLine: 'underline' }}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.md },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    minHeight: 52,
    borderRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  action: { minHeight: HIT, minWidth: HIT, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
});
