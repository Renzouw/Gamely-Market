import { DEFAULT_ALERTS, type AlertPrefs } from '@shared/api';
import type { Platform } from '@shared/types';
import { all, placeholders, run, type Db } from '../db';
import { readFx } from '../ingest/fx';
import { refreshGames, withPriceLock } from '../ingest/prices';
import { pricesFor, tx, type PriceChange, type PriceRow } from '../store';
import { nextSendTime, planAlertCandidates, planEnding, type DeviceCtx, type PlannedAlert, type WatchCtx } from './plan';

interface WatchJoin {
  device_id: string;
  game_id: string;
  target: number | null;
  alerts: string;
  title: string;
  platform: Platform;
  currency: string;
  home_region: string;
  switch_regions: string;
  tz: string;
  quiet_start: number | null;
  quiet_end: number | null;
}

function watchersOf(db: Db, gameIds: string[]): WatchJoin[] {
  if (!gameIds.length) return [];
  return all<WatchJoin>(
    db,
    `SELECT w.device_id, w.game_id, w.target, w.alerts, g.title, g.platform,
            d.currency, d.home_region, d.switch_regions, d.tz, d.quiet_start, d.quiet_end
     FROM watches w JOIN devices d ON d.id = w.device_id JOIN games g ON g.id = w.game_id
     WHERE w.game_id IN (${placeholders(gameIds.length)})`,
    ...gameIds,
  );
}

function ctx(w: WatchJoin): { device: DeviceCtx; watch: WatchCtx } {
  return {
    device: {
      id: w.device_id,
      currency: w.currency,
      homeRegion: w.home_region,
      switchRegions: JSON.parse(w.switch_regions),
    },
    watch: {
      gameId: w.game_id,
      title: w.title,
      platform: w.platform,
      target: w.target ?? undefined,
      alerts: { ...DEFAULT_ALERTS, ...(JSON.parse(w.alerts) as Partial<AlertPrefs>) },
    },
  };
}

function enqueue(db: Db, w: WatchJoin, a: PlannedAlert, now: number): boolean {
  const res = run(
    db,
    `INSERT OR IGNORE INTO notifications (device_id, game_id, kind, dedupe_key, title, body, data, created_at, send_after, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    w.device_id,
    w.game_id,
    a.kind,
    a.dedupeKey,
    a.title,
    a.body,
    JSON.stringify({ gameId: w.game_id, kind: a.kind }),
    now,
    nextSendTime(now, w.tz, w.quiet_start, w.quiet_end),
    a.expiresAt ?? null,
  );
  return Number(res.changes) > 0;
}

/**
 * Re-price games and queue alerts for what changed, as one locked step, so
 * no other refresh can slip changes in between applying and planning.
 */
export function refreshAndAlert(db: Db, gameIds: string[]): Promise<{ changes: PriceChange[]; queued: number }> {
  return withPriceLock(async () => {
    const changes = await refreshGames(db, gameIds);
    return { changes, queued: queueAlertsForChanges(db, changes) };
  });
}

/** Turn a batch of price changes into queued notifications for everyone watching those games. */
export function queueAlertsForChanges(db: Db, changes: PriceChange[], now = Date.now()): number {
  if (!changes.length) return 0;
  const byGame = new Map<string, PriceChange[]>();
  for (const c of changes) byGame.set(c.gameId, [...(byGame.get(c.gameId) ?? []), c]);
  const gameIds = [...byGame.keys()];
  const watchers = watchersOf(db, gameIds);
  if (!watchers.length) return 0;

  const after = pricesFor(db, gameIds);
  const fx = readFx(db);
  let queued = 0;
  tx(db, () => {
    for (const w of watchers) {
      const gameChanges = byGame.get(w.game_id) ?? [];
      const afterRows = after.get(w.game_id) ?? [];
      // Rebuild what the prices looked like before this refresh
      const beforeMap = new Map<string, PriceRow>(afterRows.map((r) => [r.country, r]));
      for (const c of gameChanges) {
        if (c.before) beforeMap.set(c.country, c.before);
        else beforeMap.delete(c.country);
      }
      const { device, watch } = ctx(w);
      const plans = planAlertCandidates({
        device,
        watch,
        before: [...beforeMap.values()],
        after: afterRows,
        newLowCountries: gameChanges.filter((c) => c.newLow).map((c) => c.country),
        fx,
      });
      // First candidate that isn't a repeat wins
      if (plans.some((p) => enqueue(db, w, p, now))) queued++;
    }
  });
  return queued;
}

/** Remind watchers about sales that end within the next day. */
export function queueEndingAlerts(db: Db, now = Date.now()): number {
  const soon = new Date(now + 24 * 3600_000).toISOString();
  const nowIso = new Date(now).toISOString();
  const ids = all<{ id: string }>(
    db,
    `SELECT DISTINCT g.id FROM games g JOIN watches w ON w.game_id = g.id
     WHERE g.on_sale = 1 AND g.sale_ends_at > ? AND g.sale_ends_at <= ?`,
    nowIso,
    soon,
  ).map((r) => r.id);
  if (!ids.length) return 0;
  const prices = pricesFor(db, ids);
  const fx = readFx(db);
  let queued = 0;
  tx(db, () => {
    for (const w of watchersOf(db, ids)) {
      const { device, watch } = ctx(w);
      const plan = planEnding({ device, watch, rows: prices.get(w.game_id) ?? [], fx, now });
      if (plan && enqueue(db, w, plan, now)) queued++;
    }
  });
  return queued;
}
