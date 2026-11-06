import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DeviceSettings } from '@shared/api';
import { api, onDeviceReset } from '../api/client';
import { useServer } from '../api/server';
import { deviceTimeZone, useSettings } from '../state/settings';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || undefined;

/** Why push can't work on this build, if it can't. Shown in Settings › Data sources. */
export function pushUnavailableReason(): string | undefined {
  if (Platform.OS === 'web') return 'Push alerts need the iOS or Android app.';
  if (!Device.isDevice) return 'Push alerts need a real phone, not a simulator.';
  if (!projectId) return 'This build has no EAS project ID, so it cannot receive push alerts.';
  return undefined;
}

async function pushToken(): Promise<string | undefined> {
  if (pushUnavailableReason()) return undefined;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return undefined;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('price-alerts', {
      name: 'Price alerts',
      // eslint-disable-next-line import/namespace -- re-exported with `export *`, which the lint plugin can't follow
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#C8F04A',
    });
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return undefined;
  }
}

export type EnableResult = { ok: true } | { ok: false; reason: 'unavailable'; message: string } | { ok: false; reason: 'denied'; canAskAgain: boolean };

/** Set when we sent the person to the OS settings to allow notifications. */
let waitingForSettings = false;
export const markWaitingForSettings = () => void (waitingForSettings = true);

/**
 * Ask for notification permission. Alerts only count as on when this build
 * can actually receive pushes and the OS allows them.
 */
export async function enableAlerts(): Promise<EnableResult> {
  const set = useSettings.getState().set;
  set({ alertsPrompted: true });
  // Notifications still work without server push: the phone checks and alerts by itself
  if (Platform.OS === 'web') return { ok: false, reason: 'unavailable', message: 'Price alerts work in the iOS and Android apps.' };
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  set({ alertsEnabled: perm.granted });
  await syncDevice().catch(() => undefined);
  return perm.granted ? { ok: true } : { ok: false, reason: 'denied', canAskAgain: perm.canAskAgain };
}

/**
 * Keep the in-app switch honest when the person changes notification
 * permission in the OS settings while the app is in the background.
 */
export async function reconcilePermission(): Promise<void> {
  if (Platform.OS === 'web') return;
  const { alertsEnabled, set } = useSettings.getState();
  const perm = await Notifications.getPermissionsAsync();
  if (alertsEnabled && !perm.granted) set({ alertsEnabled: false });
  else if (!alertsEnabled && perm.granted && waitingForSettings) set({ alertsEnabled: true });
  waitingForSettings = false;
}

let lastSent = '';
// A fresh registration on the server knows nothing yet, so send everything again
onDeviceReset(() => (lastSent = ''));

/** Tell the server where and how to reach this phone. Cheap to call often; it only sends changes. */
/** Returns true when settings were sent (so server-side values like converted targets may have changed). */
export async function syncDevice(): Promise<boolean> {
  // Nothing to tell when the server isn't around; it gets everything once it's back
  if (useServer.getState().mode !== 'server') return false;
  const s = useSettings.getState();
  const body: DeviceSettings = {
    pushToken: s.alertsEnabled ? ((await pushToken()) ?? null) : null,
    os: Platform.OS,
    homeRegion: s.homeRegion,
    currency: s.homeCurrency,
    switchRegions: s.switchRegions,
    steamRegions: s.steamRegions,
    tz: deviceTimeZone(),
    quietStart: s.quietHours ? s.quietStart : null,
    quietEnd: s.quietHours ? s.quietEnd : null,
    alertsEnabled: s.alertsEnabled,
    eventAlerts: { storeSales: s.eventStoreSales, bigDeals: s.eventBigDeals, platforms: s.eventPlatforms, minDiscount: s.eventMinDiscount },
  };
  const key = JSON.stringify(body);
  if (key === lastSent) return false;
  await api('/v1/devices/me', { method: 'PUT', body, auth: true });
  lastSent = key;
  return true;
}
