import type { ApiWatch } from '@shared/api';
import { api, ApiError } from '../api/client';
import { useServer } from '../api/server';
import { useWatchlist } from '../state/watchlist';

/**
 * Bring the server's copy of the watchlist in line with the phone's. The
 * phone is the source of truth: games watched while offline get added,
 * games removed while offline get removed.
 */
let running: Promise<void> | undefined;
let again = false;

export function syncWatches(): Promise<void> {
  // A change made while a sync is on its way may already have been passed: go round once more after
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    if (useServer.getState().mode !== 'server') return;
    // Until the saved watchlist loads it looks empty, and every watch on the server would be deleted
    if (!useWatchlist.persist.hasHydrated()) return;
    const store = useWatchlist.getState();
    for (const key of store.removed) {
      await api(`/v1/watches/${encodeURIComponent(key)}`, { method: 'DELETE', auth: true }).catch(() => undefined);
      useWatchlist.getState().clearRemoved(key);
    }
    const server = await api<{ items: ApiWatch[] }>('/v1/watches', { auth: true });
    const onServer = new Set(server.items.map((w) => w.game.key));
    for (const w of Object.values(useWatchlist.getState().items)) {
      if (w.synced && onServer.has(w.game.key)) continue;
      const version = w.updatedAt;
      try {
        await api(`/v1/watches/${encodeURIComponent(w.game.key)}`, {
          method: 'PUT',
          auth: true,
          body: {
            target: w.target ?? null,
            alerts: w.alerts,
            // Lets the server start tracking a game it hasn't seen yet
            game: { platform: w.game.platform, title: w.game.title, image: w.game.image, publisher: w.game.publisher, steamAppId: w.game.steamAppId, productCode: w.game.productCode },
          },
        });
        useWatchlist.getState().markSynced(w.game.key, version);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 0) throw e; // server went away: try again later
      }
    }
    const local = useWatchlist.getState().items;
    for (const key of onServer) {
      if (!local[key]) await api(`/v1/watches/${encodeURIComponent(key)}`, { method: 'DELETE', auth: true }).catch(() => undefined);
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      running = undefined;
      if (again) {
        again = false;
        void syncWatches();
      }
    });
  return running;
}
