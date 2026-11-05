import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Open the game screen when someone taps a price alert. */
export function useNotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const key = last?.notification.request.content.data?.key;
    if (typeof key === 'string') router.push({ pathname: '/game/[key]', params: { key } });
  }, [last]);
}
