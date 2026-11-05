import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DeviceSettings } from '@shared/api';
import { api } from '../api/client';
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

/** Ask for notification permission. Returns whether alerts can now be delivered. */
export async function enableAlerts(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  useSettings.getState().set({ alertsEnabled: perm.granted, alertsPrompted: true });
  await syncDevice();
  return perm.granted;
}

let lastSent = '';

/** Tell the server where and how to reach this phone. Cheap to call often; it only sends changes. */
export async function syncDevice(): Promise<void> {
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
  };
  const key = JSON.stringify(body);
  if (key === lastSent) return;
  await api('/v1/devices/me', { method: 'PUT', body, auth: true });
  lastSent = key;
}
