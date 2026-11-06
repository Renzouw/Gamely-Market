import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useTheme } from '../theme';
import { Text } from '../theme/Text';
import { Button } from './ui';

/** Coming back to the app after this long checks for a new version again (launch always checks). */
export const RECHECK_AFTER_MS = 15 * 60_000;

export function shouldRecheck(lastCheck: Date | undefined, now = Date.now()): boolean {
  return !lastCheck || now - lastCheck.getTime() >= RECHECK_AFTER_MS;
}

/**
 * "A new version is ready" once an over-the-air update has downloaded, with a
 * button that switches to it now. Without the tap it's used at the next launch
 * anyway. Development builds, Expo Go and web don't take updates, so nothing
 * shows there.
 */
export function UpdateToast() {
  if (Platform.OS === 'web' || !Updates.isEnabled) return null;
  return <UpdateToastInner />;
}

function UpdateToastInner() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { isUpdatePending, downloadedUpdate, lastCheckForUpdateTimeSinceRestart } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState<string>();
  const [restarting, setRestarting] = useState(false);
  const lastCheck = useRef(lastCheckForUpdateTimeSinceRestart);
  useEffect(() => {
    lastCheck.current = lastCheckForUpdateTimeSinceRestart;
  }, [lastCheckForUpdateTimeSinceRestart]);

  // Launch checks on its own; also check when someone comes back to the app after a while
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !shouldRecheck(lastCheck.current)) return;
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // No connection or the update server is busy: the next launch tries again
      }
    });
    return () => sub.remove();
  }, []);

  const id = downloadedUpdate?.updateId ?? 'pending';
  if (!isUpdatePending || dismissed === id) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 64 }]}>
      <View accessibilityRole="alert" style={[styles.toast, { backgroundColor: c.surface, borderColor: c.line }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">A new version is ready</Text>
          <Text variant="footnote" tone="muted">
            Restart Gamely to use it now.
          </Text>
        </View>
        <Button
          label="Restart"
          loading={restarting}
          style={styles.button}
          onPress={() => {
            setRestarting(true);
            Updates.reloadAsync().catch(() => setRestarting(false));
          }}
        />
        <Pressable onPress={() => setDismissed(id)} hitSlop={13} accessibilityRole="button" accessibilityLabel="Not now">
          <Ionicons name="close" size={18} color={c.subtle} />
        </Pressable>
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
    padding: space.md,
    paddingLeft: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  button: { height: 40, paddingHorizontal: space.lg },
});
