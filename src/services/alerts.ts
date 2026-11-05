import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fetchFx } from '../api/fx';
import { regionalPricesFor } from '../api/prices';
import { formatMoney, summarize } from '../domain/pricing';
import { regionLabel } from '../domain/regions';
import type { FxRates } from '../domain/types';
import { useSettings } from '../state/settings';
import { useWatchlist } from '../state/watchlist';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function notify(title: string, body: string, key: string) {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: { key } }, trigger: null });
}

export interface RefreshResult {
  checked: number;
  hits: string[];
  failed: number;
}

/**
 * Re-price every watched game, record the result in its history, and send
 * a notification for each game that just dropped to its target. Used by
 * pull-to-refresh and by the background task.
 */
export async function refreshWatchlist(opts: { fx?: FxRates } = {}): Promise<RefreshResult> {
  // In a background launch the persisted stores may not be loaded yet.
  await Promise.all([useSettings.persist.rehydrate(), useWatchlist.persist.rehydrate()]);
  const settings = useSettings.getState();
  const watch = useWatchlist.getState();
  const items = Object.values(watch.items);
  const fx = opts.fx ?? (await fetchFx().catch(() => undefined));

  let failed = 0;
  const hits: string[] = [];
  await Promise.all(
    items.map(async (item) => {
      try {
        const { prices } = await regionalPricesFor(item.game, settings);
        const summary = summarize(prices, { homeCurrency: settings.homeCurrency, homeRegion: settings.homeRegion, fx });
        if (!summary.best || summary.best.converted === undefined) return;
        const hit = useWatchlist.getState().record(item.game.key, summary.best.converted, summary.best.country);
        if (hit) {
          hits.push(item.game.key);
          if (settings.alertsEnabled) {
            const where = regionLabel(summary.best.country);
            await notify(
              `${item.game.title} hit your price`,
              `${formatMoney(summary.best.converted, settings.homeCurrency)} in ${where.flag} ${where.name}`,
              item.game.key,
            );
            useWatchlist.getState().markAlerted(item.game.key);
          }
        }
      } catch {
        failed++;
      }
    }),
  );
  return { checked: items.length, hits, failed };
}
