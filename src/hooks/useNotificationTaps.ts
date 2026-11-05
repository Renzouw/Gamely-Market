import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Open the right screen when someone taps an alert, and refresh what the alert was about. */
export function useNotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  const qc = useQueryClient();
  useEffect(() => {
    const data = last?.notification.request.content.data as { gameId?: string; screen?: string } | undefined;
    if (!data) return;
    qc.invalidateQueries({ queryKey: ['activity'] });
    qc.invalidateQueries({ queryKey: ['watches'] });
    if (typeof data.gameId === 'string') router.push({ pathname: '/game/[key]', params: { key: data.gameId } });
    else if (data.screen === 'activity') router.push({ pathname: '/watchlist', params: { tab: 'alerts' } });
  }, [last, qc]);
}
