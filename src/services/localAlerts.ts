import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { convert, summarize } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { FxRates } from '@shared/types';
import { getFx, getWatchPrices } from '../api/data';
import { serverHandlesPush } from '../api/server';
import { localLows, useLocalHistory } from '../direct/history';
import { useLocalActivity } from '../state/activity';
import { useSettings } from '../state/settings';
import { useWatchlist } from '../state/watchlist';
import { planLocalAlert } from './localPlan';
import { pushUnavailableReason } from './push';

let fxCache: { at: number; fx: FxRates } | undefined;

/**
 * Check watched games from the phone and raise alerts itself. This is how
 * alerts work when your PC's server is off. When the server is handling
 * push for this phone, this still keeps the watchlist's numbers fresh but
 * stays quiet, so you never get the same alert twice.
 */
export async function runLocalCheck(): Promise<{ checked: number; alerted: number }> {
  // In a background launch the saved stores may not be loaded yet. Reloading one
  // that is would throw away changes still on their way to disk.
  await Promise.all(
    [useSettings, useWatchlist, useLocalHistory, useLocalActivity].map((s) => (s.persist.hasHydrated() ? undefined : s.persist.rehydrate())),
  );
  const watches = Object.values(useWatchlist.getState().items);
  if (!watches.length) return { checked: 0, alerted: 0 };

  if (!fxCache || Date.now() - fxCache.at > 6 * 3600_000) {
    const fx = await getFx().catch(() => undefined);
    if (fx) fxCache = { at: Date.now(), fx };
  }
  const fx = fxCache?.fx;
  const s = useSettings.getState();

  // Read each game's history low before this check adds to it
  const lowsBefore = new Map<string, number | undefined>();
  for (const w of watches) {
    let low: number | undefined;
    for (const l of localLows(useLocalHistory.getState().games[w.game.key]?.rows ?? [])) {
      const v = convert(l.price, l.currency, s.homeCurrency, fx);
      if (v !== undefined && (low === undefined || v < low)) low = v;
    }
    lowsBefore.set(w.game.key, low);
  }

  const prices = await getWatchPrices(
    watches.map((w) => w.game),
    fx,
  );
  const quiet = serverHandlesPush(!pushUnavailableReason() && s.alertsEnabled);
  let canNotify = false;
  if (!quiet && s.alertsEnabled && Platform.OS !== 'web') {
    canNotify = (await Notifications.getPermissionsAsync().catch(() => ({ granted: false }))).granted;
  }

  let alerted = 0;
  const updates: Parameters<ReturnType<typeof useWatchlist.getState>['setLastMany']>[0] = [];
  for (const w of watches) {
    const p = prices[w.game.key]?.prices;
    if (!p?.length) continue;
    const home = w.game.platform === 'steam' ? steamStoreCountry(s.homeRegion).code : s.homeRegion;
    const sum = summarize(w.game.platform === 'steam' ? p.filter((x) => x.country === home) : p, { homeCurrency: s.homeCurrency, homeRegion: home, fx });
    // No price we can read in your currency (a store didn't answer, no exchange rate yet): keep the last good numbers
    if (sum.best?.converted === undefined) continue;
    const alert = quiet ? undefined : planLocalAlert(w, sum, s.homeCurrency, lowsBefore.get(w.game.key), Date.now(), fx);
    const sent = alert ? [...w.sent, alert.key] : w.sent;
    if (alert) {
      useLocalActivity.getState().add({ kind: alert.kind, title: alert.title, body: alert.body, gameId: w.game.key, image: w.game.image });
      if (canNotify) {
        await Notifications.scheduleNotificationAsync({ content: { title: alert.title, body: alert.body, data: { gameId: w.game.key } }, trigger: null }).catch(() => undefined);
      }
      alerted++;
    }
    updates.push({
      key: w.game.key,
      last: {
        best: sum.best?.converted,
        bestLocal: sum.best ? { amount: sum.best.current.amount, currency: sum.best.current.currency } : undefined,
        country: sum.best?.country,
        onSale: sum.ranked.some((p) => p.sale),
        homeOnSale: !!sum.home?.sale,
        checkedAt: Date.now(),
      },
      sent,
    });
  }
  useWatchlist.getState().setLastMany(updates);
  return { checked: watches.length, alerted };
}
