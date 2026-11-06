import type { ApiList, ApiListItem, DealQuery } from '@shared/api';
import { summarize, type PriceSummary } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { FxRates, Platform } from '@shared/types';
import { all, type Db } from '../db';
import { nsuidsForGames, pricesFor, rowToGame, rowToPrice, type GameRow, type PriceRow } from '../store';

/**
 * Everything currently on sale for a platform, held in memory. Rebuilt only
 * when prices change (the version bumps), so deal requests never hit the
 * database for the heavy part.
 */
let version = 0;
export const bumpVersion = () => void version++;

const cache = new Map<Platform, { version: number; rows: { game: GameRow; prices: PriceRow[] }[] }>();

function saleIndex(db: Db, platform: Platform) {
  const hit = cache.get(platform);
  if (hit && hit.version === version) return hit.rows;
  const games = all<GameRow>(db, 'SELECT * FROM games WHERE platform = ? AND on_sale = 1', platform);
  const prices = pricesFor(db, games.map((g) => g.id));
  const rows = games.map((game) => ({ game, prices: prices.get(game.id) ?? [] }));
  cache.set(platform, { version, rows });
  return rows;
}

/** Regions that count for a caller on this platform. Steam: the store country they buy in. */
export function effectiveRegions(platform: Platform, home: string, regions: string[]): { regions: string[]; home: string } {
  if (platform === 'steam') {
    const store = steamStoreCountry(home).code;
    return { regions: [...new Set([store, ...regions])], home: store };
  }
  return { regions: regions.includes(home) ? regions : [...regions, home], home };
}

/** The regions a deals list covers. With one country picked, only that eShop counts. */
function dealRegions(q: DealQuery): { regions: string[]; home: string } {
  return q.country && q.platform !== 'steam' ? { regions: [q.country], home: q.country } : effectiveRegions(q.platform, q.home, q.regions);
}

/** Cursors are plain offsets. Anything negative, fractional or garbled starts from the top. */
export function parseCursor(c?: string): number {
  const n = Math.floor(Number(c));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rankDeals(db: Db, q: DealQuery, fx: FxRates | undefined, now: number): Ranked[] {
  const { regions, home } = dealRegions(q);
  // For Steam, a "deal" means discounted in the store you can buy from.
  const saleRegions = new Set(q.platform === 'steam' ? [home] : regions);
  const wanted = new Set(regions);

  const scored: Ranked[] = [];
  for (const { game, prices } of saleIndex(db, q.platform)) {
    const mine = prices.filter((p) => wanted.has(p.country)).map((p) => rowToPrice(p, now));
    // Must be on sale somewhere this person can actually buy it
    if (!mine.some((p) => p.sale && saleRegions.has(p.country))) continue;
    // On Steam you pay your own store's price, so rank and filter on that alone
    const s = summarize(q.platform === 'steam' ? mine.filter((p) => p.country === home) : mine, { homeCurrency: q.currency, homeRegion: home, fx });
    if (q.minDiscount && (s.best?.discountPercent ?? 0) < q.minDiscount) continue;
    if (q.maxPrice !== undefined && (s.best?.converted === undefined || s.best.converted > q.maxPrice)) continue;
    if (q.abroad && (s.savingVsHome ?? 0) < q.abroad) continue;
    scored.push({ item: { game: rowToGame(game), prices: mine }, s, game });
  }

  const endOf = (x: (typeof scored)[number]) => Date.parse(x.s.best?.saleEndsAt ?? '') || Infinity;
  const rankOf = (x: (typeof scored)[number]) => x.game.rank ?? Number.MAX_SAFE_INTEGER;
  scored.sort((a, b) => {
    switch (q.sort) {
      case 'discount':
        return (b.s.best?.discountPercent ?? 0) - (a.s.best?.discountPercent ?? 0) || rankOf(a) - rankOf(b);
      case 'cheapest':
        return (a.s.best?.converted ?? Infinity) - (b.s.best?.converted ?? Infinity) || rankOf(a) - rankOf(b);
      case 'ending':
        return endOf(a) - endOf(b) || rankOf(a) - rankOf(b);
      case 'newest':
        return (Date.parse(b.game.release_date ?? '') || 0) - (Date.parse(a.game.release_date ?? '') || 0);
      default:
        return rankOf(a) - rankOf(b);
    }
  });
  return scored;
}

type Ranked = { item: ApiListItem; s: PriceSummary; game: GameRow };
/** What the cache keeps: just the order. Pages are built from the shared sale index on demand. */
type Entry = { game: GameRow; prices: PriceRow[] };

/**
 * Ranked results per distinct query, reused until prices change or the
 * minute turns (so sale-end cutoffs stay accurate). Ranking 3,000 sale games
 * costs ~150ms; a cache hit costs well under 1ms. Entries point into the
 * shared sale index instead of copying prices, so each cached query costs a
 * few kilobytes, not megabytes.
 */
const rankedCache = new Map<string, { version: number; minute: number; rows: Entry[] }>();
const RANKED_CACHE_MAX = 200;

export function listDeals(db: Db, q: DealQuery, fx: FxRates | undefined, now = Date.now()): ApiList {
  const key = JSON.stringify([q.platform, q.sort, q.home, q.currency, [...q.regions].sort(), q.minDiscount, q.maxPrice, q.abroad, q.country, fx?.updatedAt]);
  const minute = Math.floor(now / 60_000);
  let hit = rankedCache.get(key);
  if (!hit || hit.version !== version || hit.minute !== minute) {
    const index = new Map(saleIndex(db, q.platform).map((e) => [e.game.id, e]));
    hit = { version, minute, rows: rankDeals(db, q, fx, now).map((r) => index.get(r.game.id)!) };
    rankedCache.delete(key);
    rankedCache.set(key, hit);
    if (rankedCache.size > RANKED_CACHE_MAX) rankedCache.delete(rankedCache.keys().next().value!);
  }
  const { regions } = dealRegions(q);
  const wanted = new Set(regions);
  const limit = Math.min(q.limit ?? 30, 100);
  const offset = parseCursor(q.cursor);
  const page = hit.rows.slice(offset, offset + limit);
  const nsuids = nsuidsForGames(db, page.map((p) => p.game.id));
  const items = page.map((e) => ({
    game: rowToGame(e.game, nsuids.get(e.game.id)),
    prices: e.prices.filter((p) => wanted.has(p.country)).map((p) => rowToPrice(p, now)),
  }));
  return {
    items,
    total: hit.rows.length,
    nextCursor: offset + limit < hit.rows.length ? String(offset + limit) : undefined,
    checkedAt: Math.max(0, ...items.flatMap((i) => i.prices.map((p) => p.checkedAt))) || undefined,
  };
}

export type DirectoryPlatform = Platform | 'all-switch';

/** With `country`, only games that eShop sells, priced there alone. */
export function searchGames(db: Db, p: { platform: DirectoryPlatform; key: string; regions: string[]; country?: string; cursor?: string; limit?: number }, now = Date.now()): ApiList {
  const platforms = p.platform === 'all-switch' ? ['switch', 'switch2'] : [p.platform];
  const limit = Math.min(p.limit ?? 30, 100);
  const offset = parseCursor(p.cursor);
  const country = p.platform !== 'steam' ? p.country : undefined;
  const where =
    `platform IN (${platforms.map(() => '?').join(', ')})` +
    (p.key ? ' AND title_key LIKE ?' : '') +
    (country ? ' AND EXISTS (SELECT 1 FROM prices WHERE prices.game_id = games.id AND prices.country = ?)' : '');
  const params: string[] = [...platforms];
  if (p.key) params.push(`%${p.key}%`);
  if (country) params.push(country);
  if (country) p = { ...p, regions: [country] };
  const total = all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM games WHERE ${where}`, ...params)[0]?.n ?? 0;
  const order = p.key
    ? 'CASE WHEN title_key = ? THEN 0 WHEN title_key LIKE ? THEN 1 ELSE 2 END, COALESCE(rank, 1e9), title'
    : 'COALESCE(rank, 1e9), title';
  const orderParams = p.key ? [p.key, `${p.key}%`] : [];
  const games = all<GameRow>(db, `SELECT * FROM games WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, ...orderParams, limit, offset);
  const prices = pricesFor(db, games.map((g) => g.id), p.regions);
  const nsuids = nsuidsForGames(db, games.map((g) => g.id));
  const items = games.map((g) => ({ game: rowToGame(g, nsuids.get(g.id)), prices: (prices.get(g.id) ?? []).map((r) => rowToPrice(r, now)) }));
  return {
    items,
    total,
    nextCursor: offset + limit < total ? String(offset + limit) : undefined,
    checkedAt: Math.max(0, ...items.flatMap((i) => i.prices.map((x) => x.checkedAt))) || undefined,
  };
}
