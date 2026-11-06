import { Alert, Linking } from 'react-native';
import { enableAlerts, markWaitingForSettings } from './push';

/**
 * Turn alerts on from any button, and tell the person what happened when it
 * can't work. We only send them to the OS settings when the OS won't show
 * its own prompt any more.
 */
export async function turnOnAlerts(): Promise<boolean> {
  const r = await enableAlerts();
  if (r.ok) return true;
  if (r.reason === 'unavailable') {
    Alert.alert('Push alerts aren’t available here', r.message);
  } else if (!r.canAskAgain) {
    Alert.alert('Notifications are off for Gamely', 'Allow notifications in Settings to get price alerts.', [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          markWaitingForSettings();
          Linking.openSettings().catch(() => undefined);
        },
      },
    ]);
  }
  return false;
}
