import { DEFAULT_EVENT_ALERTS, type ApiSaleEvent, type EventPrefs } from '@shared/api';
import type { Platform } from '@shared/types';
import { all, get, run, type Db } from '../db';
import { nextSendTime, type DeviceCtx } from '../alerts/plan';
import { readFx } from '../ingest/fx';
import { pricesFor, tx } from '../store';
import { composeDeals, composeEvent, evaluate, pickBigDeals, type DealCandidate, type PickedDeal } from './detect';

const HOUR = 3600_000;
const PLATFORMS: Platform[] = ['switch2', 'switch', 'steam'];

/** Only games this popular count as "big deals" (store popularity rank). */
export const POPULAR_RANK: Record<Platform, number> = { switch2: 120, switch: 300, steam: 150 };
/** At most one big-deals push per person in this window. */
export const DEAL_GAP_MS = 12 * HOUR;

export function recordSaleCount(db: Db, source: Platform, count: number, now = Date.now()) {
  if (!Number.isFinite(count) || count < 0) return;
  run(db, 'INSERT OR REPLACE INTO sale_counts (source, t, count) VALUES (?, ?, ?)', source, Math.floor(now / HOUR) * HOUR, Math.round(count));
}

export function activeEvents(db: Db): ApiSaleEvent[] {
  return all<{ id: number; platform: Platform; started_at: number; latest: number; baseline: number }>(
    db,
    'SELECT id, platform, started_at, latest, baseline FROM sale_events WHERE ended_at IS NULL ORDER BY started_at DESC',
  ).map((r) => ({ id: r.id, platform: r.platform, startedAt: r.started_at, count: r.latest, baseline: r.baseline }));
}

interface DeviceRow {
  id: string;
  currency: string;
  home_region: string;
  switch_regions: string;
  steam_regions: string;
  tz: string;
  quiet_start: number | null;
  quiet_end: number | null;
  event_alerts: string;
}

function devicesWithPush(db: Db): { row: DeviceRow; ctx: DeviceCtx; prefs: EventPrefs }[] {
  return all<DeviceRow>(db, 'SELECT * FROM devices WHERE alerts_enabled = 1').map((row) => ({
    row,
    ctx: { id: row.id, currency: row.currency, homeRegion: row.home_region, switchRegions: JSON.parse(row.switch_regions) },
    prefs: { ...DEFAULT_EVENT_ALERTS, ...(JSON.parse(row.event_alerts || '{}') as Partial<EventPrefs>) },
  }));
}

function enqueue(db: Db, d: DeviceRow, kind: 'event' | 'deals', dedupeKey: string, msg: { title: string; body: string; data: Record<string, unknown> }, now: number, expiresAt?: number) {
  const res = run(
    db,
    `INSERT OR IGNORE INTO notifications (device_id, game_id, kind, dedupe_key, title, body, data, created_at, send_after, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.id,
    typeof msg.data.gameId === 'string' ? msg.data.gameId : null,
    kind,
    dedupeKey,
    msg.title,
    msg.body,
    JSON.stringify(msg.data),
    now,
    nextSendTime(now, d.tz, d.quiet_start, d.quiet_end),
    expiresAt ?? null,
  );
  return Number(res.changes) > 0;
}

/** Popular games currently discounted, with their prices in every region. */
function dealCandidates(db: Db, platforms: Platform[], changedSince?: number): DealCandidate[] {
  const rows = all<{ id: string; title: string; platform: Platform; rank: number }>(
    db,
    `SELECT id, title, platform, rank FROM games WHERE on_sale = 1 AND rank IS NOT NULL
       AND ((platform = 'switch2' AND rank < ?) OR (platform = 'switch' AND rank < ?) OR (platform = 'steam' AND rank < ?))`,
    POPULAR_RANK.switch2,
    POPULAR_RANK.switch,
    POPULAR_RANK.steam,
  ).filter((r) => platforms.includes(r.platform));
  const prices = pricesFor(db, rows.map((r) => r.id));
  return rows
    .map((r) => ({ gameId: r.id, title: r.title, platform: r.platform, rank: r.rank, prices: prices.get(r.id) ?? [] }))
    .filter((c) => changedSince === undefined || c.prices.some((p) => p.sale !== null && p.changed_at >= changedSince));
}

/**
 * Compare each store's discounted count with a normal day. A big jump
 * starts a sale event and tells everyone who wants store-wide sale alerts.
 */
export function detectSaleEvents(db: Db, now = Date.now()): ApiSaleEvent[] {
  const started: { id: number; platform: Platform; count: number; baseline: number }[] = [];
  tx(db, () => {
    for (const platform of PLATFORMS) {
      const latest = get<{ count: number; t: number }>(db, 'SELECT count, t FROM sale_counts WHERE source = ? ORDER BY t DESC LIMIT 1', platform);
      if (!latest || now - latest.t > 3 * HOUR) continue; // no fresh reading, decide nothing
      const active = get<{ id: number; baseline: number; peak: number }>(db, 'SELECT id, baseline, peak FROM sale_events WHERE platform = ? AND ended_at IS NULL', platform);
      const history = all<{ t: number; count: number }>(db, 'SELECT t, count FROM sale_counts WHERE source = ? AND t >= ?', platform, now - 9 * 24 * HOUR);
      const decision = evaluate({ platform, current: latest.count, history, active, now });
      if (decision.action === 'start') {
        const res = run(db, 'INSERT INTO sale_events (platform, started_at, baseline, latest, peak) VALUES (?, ?, ?, ?, ?)', platform, now, decision.baseline, latest.count, latest.count);
        started.push({ id: Number(res.lastInsertRowid), platform, count: latest.count, baseline: decision.baseline });
      } else if (decision.action === 'update' && active) {
        run(db, 'UPDATE sale_events SET latest = ?, peak = MAX(peak, ?) WHERE id = ?', latest.count, latest.count, active.id);
      } else if (decision.action === 'end' && active) {
        run(db, 'UPDATE sale_events SET ended_at = ?, latest = ? WHERE id = ?', now, latest.count, active.id);
      }
    }
  });
  if (started.length) notifyEvents(db, started, now);
  return activeEvents(db);
}

function notifyEvents(db: Db, started: { id: number; platform: Platform; count: number; baseline: number }[], now: number) {
  const fx = readFx(db);
  const candidates = dealCandidates(db, PLATFORMS);
  tx(db, () => {
    for (const { row, ctx, prefs } of devicesWithPush(db)) {
      if (!prefs.storeSales) continue;
      const mine = started.filter((e) => (prefs.platforms as readonly Platform[]).includes(e.platform));
      if (!mine.length) continue;
      const picks = pickBigDeals({ device: ctx, prefs: { ...prefs, platforms: mine.map((e) => e.platform) as EventPrefs['platforms'] }, candidates, watched: new Set(), seen: new Set(), fx, now });
      const msg = composeEvent(mine, picks);
      enqueue(db, row, 'event', `event:${row.id}:${mine.map((e) => e.id).join('+')}`, msg, now, now + 3 * 24 * HOUR);
    }
  });
}

/**
 * Popular games that recently went deep on sale, as one digest per person,
 * at most once every 12 hours.
 */
export function queueBigDeals(db: Db, now = Date.now()): number {
  const fx = readFx(db);
  const candidates = dealCandidates(db, PLATFORMS, now - 26 * HOUR);
  if (!candidates.length) return 0;
  let queued = 0;
  tx(db, () => {
    for (const { row, ctx, prefs } of devicesWithPush(db)) {
      if (!prefs.bigDeals) continue;
      const recent = get<{ n: number }>(db, "SELECT 1 AS n FROM notifications WHERE device_id = ? AND kind IN ('deals', 'event') AND created_at > ?", row.id, now - DEAL_GAP_MS);
      if (recent) continue;
      const watched = new Set(all<{ game_id: string }>(db, 'SELECT game_id FROM watches WHERE device_id = ?', row.id).map((w) => w.game_id));
      const seen = new Set(all<{ game_id: string; sale_key: string }>(db, 'SELECT game_id, sale_key FROM deal_seen WHERE device_id = ?', row.id).map((s) => `${s.game_id}|${s.sale_key}`));
      const picks: PickedDeal[] = pickBigDeals({ device: ctx, prefs, candidates, watched, seen, fx, now });
      if (!picks.length) continue;
      const msg = composeDeals(picks, ctx.currency);
      // Keep the digest deliverable while at least one deal is still running. Some
      // sale keys are plain dates (no known end), which aren't end times.
      const ends = picks.filter((p) => p.saleKey.includes('T')).map((p) => Date.parse(p.saleKey)).filter(Number.isFinite);
      const expires = ends.length === picks.length ? Math.max(...ends) : now + 48 * HOUR;
      if (enqueue(db, row, 'deals', `deals:${row.id}:${Math.floor(now / HOUR)}`, msg, now, expires)) {
        for (const p of picks) run(db, 'INSERT OR IGNORE INTO deal_seen (device_id, game_id, sale_key, at) VALUES (?, ?, ?, ?)', row.id, p.gameId, p.saleKey, now);
        queued++;
      }
    }
  });
  return queued;
}
