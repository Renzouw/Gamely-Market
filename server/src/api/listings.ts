import type { ApiList, ApiListItem, DealQuery, DirectoryOptions } from '@shared/api';
import { convert, summarize, type PriceSummary } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { FxRates, Platform } from '@shared/types';
import { all, placeholders, type Db } from '../db';
import { getGames, nsuidsForGames, pricesFor, rowToGame, rowToPrice, type GameRow, type PriceRow } from '../store';

/**
 * Everything currently on sale for a platform, held in memory. Rebuilt only
 * when prices change (the version bumps), so deal requests never hit the
 * database for the heavy part.
 */
let version = 0;
/**
 * Prices changed: start every cache afresh. Old entries would otherwise keep
 * a whole previous sale index alive (tens of MB each) until evicted.
 */
export const bumpVersion = () => {
  version++;
  cache.clear();
  rankedCache.clear();
  directoryCache.clear();
  aggCache.clear();
};

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

export interface DirectoryQuery extends DirectoryOptions {
  platform: DirectoryPlatform;
  /** titleKey() of the search text, or '' */
  key: string;
  home: string;
  currency: string;
  regions: string[];
  cursor?: string;
  limit?: number;
}

/** True when the order or a filter depends on prices, not just the catalog. */
const needsPrices = (q: DirectoryQuery) =>
  q.platform !== 'steam' && (q.sort === 'cheapest' || q.sort === 'discount' || !!q.onSale || !!q.minDiscount || q.maxPrice !== undefined || !!q.abroad);

const ORDER: Record<'popular' | 'newest' | 'title', string> = {
  popular: 'COALESCE(rank, 1e9), title',
  newest: "COALESCE(release_date, '') DESC, COALESCE(rank, 1e9)",
  title: 'title_key, COALESCE(rank, 1e9)',
};

/** Ordered game ids per distinct price-aware query, reused like the deals cache. */
const directoryCache = new Map<string, { version: number; minute: number; ids: string[] }>();

/**
 * Every game in the catalog, searched, sorted and filtered. With `country`,
 * only games that eShop sells, priced there alone. Sorting or filtering by
 * price streams the price rows once and keeps a few numbers per game, so the
 * whole catalog's prices never sit in memory.
 */
export function searchGames(db: Db, q: DirectoryQuery, fx?: FxRates, now = Date.now()): ApiList {
  const platforms = q.platform === 'all-switch' ? ['switch', 'switch2'] : [q.platform];
  const limit = Math.min(q.limit ?? 30, 100);
  const offset = parseCursor(q.cursor);
  const country = q.platform !== 'steam' ? q.country : undefined;
  const where =
    `games.platform IN (${platforms.map(() => '?').join(', ')})` +
    (q.key ? ' AND games.title_key LIKE ?' : '') +
    (country ? ' AND EXISTS (SELECT 1 FROM prices x WHERE x.game_id = games.id AND x.country = ?)' : '');
  const params: string[] = [...platforms];
  if (q.key) params.push(`%${q.key}%`);
  if (country) params.push(country);
  const { regions, home } = country
    ? { regions: [country], home: country }
    : effectiveRegions(q.platform === 'all-switch' ? 'switch' : q.platform, q.home, q.regions);

  let ids: string[];
  let total: number;
  if (needsPrices(q)) {
    const key = JSON.stringify([platforms, q.key, q.sort, q.onSale, q.minDiscount, q.maxPrice, q.abroad, country, home, q.currency, [...regions].sort(), fx?.updatedAt]);
    const minute = Math.floor(now / 60_000);
    let hit = directoryCache.get(key);
    if (!hit || hit.version !== version || hit.minute !== minute) {
      hit = { version, minute, ids: rankByPrice(db, q, where, params, regions, home, fx, now) };
      directoryCache.delete(key);
      directoryCache.set(key, hit);
      if (directoryCache.size > RANKED_CACHE_MAX) directoryCache.delete(directoryCache.keys().next().value!);
    }
    total = hit.ids.length;
    ids = hit.ids.slice(offset, offset + limit);
  } else {
    total = all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM games WHERE ${where}`, ...params)[0]?.n ?? 0;
    // A search shows exact and starts-with matches first, unless another order was asked for
    const sort = q.sort === 'newest' || q.sort === 'title' ? q.sort : 'popular';
    const relevance = !!q.key && sort === 'popular';
    const order = relevance ? `CASE WHEN title_key = ? THEN 0 WHEN title_key LIKE ? THEN 1 ELSE 2 END, ${ORDER.popular}` : ORDER[sort];
    const orderParams = relevance ? [q.key, `${q.key}%`] : [];
    ids = all<{ id: string }>(db, `SELECT id FROM games WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, ...orderParams, limit, offset).map((r) => r.id);
  }

  const byId = new Map(getGames(db, ids).map((g) => [g.id, g]));
  const games = ids.map((id) => byId.get(id)).filter((g): g is GameRow => !!g);
  const prices = pricesFor(db, ids, regions);
  const nsuids = nsuidsForGames(db, ids);
  const items = games.map((g) => ({ game: rowToGame(g, nsuids.get(g.id)), prices: (prices.get(g.id) ?? []).map((r) => rowToPrice(r, now)) }));
  return {
    items,
    total,
    nextCursor: offset + limit < total ? String(offset + limit) : undefined,
    checkedAt: Math.max(0, ...items.flatMap((i) => i.prices.map((x) => x.checkedAt))) || undefined,
  };
}

interface PriceRowLite {
  game_id: string;
  country: string;
  currency: string;
  regular: number;
  sale: number | null;
  discount: number;
  sale_ends_at: string | null;
}

type Agg = { best: number; bestDiscount: number; home?: number; onSale: boolean };

/**
 * Each game's best price (and its discount, home price, whether it's on sale
 * anywhere) for one set of regions, home and currency. Every sort and filter
 * reuses it, so changing a filter only re-sorts. Rebuilt when prices change,
 * or after five minutes so ended sales drop off.
 */
const aggCache = new Map<string, { version: number; window: number; agg: Map<string, Agg> }>();
const AGG_CACHE_MAX = 20;

function priceAggregates(db: Db, regions: string[], home: string, currency: string, fx: FxRates | undefined, now: number): Map<string, Agg> {
  const key = JSON.stringify([[...regions].sort(), home, currency, fx?.updatedAt]);
  const window = Math.floor(now / 300_000);
  const hit = aggCache.get(key);
  if (hit && hit.version === version && hit.window === window) return hit.agg;
  const agg = new Map<string, Agg>();
  const rows = db
    .prepare(`SELECT game_id, country, currency, regular, sale, discount, sale_ends_at FROM prices WHERE country IN (${placeholders(regions.length)})`)
    .iterate(...regions) as Iterable<PriceRowLite>;
  for (const r of rows) {
    // A sale whose end has passed counts as the regular price, as everywhere else
    const live = r.sale !== null && (r.sale_ends_at === null || Date.parse(r.sale_ends_at) > now);
    const value = convert(live ? r.sale! : r.regular, r.currency, currency, fx);
    let a = agg.get(r.game_id);
    if (!a) agg.set(r.game_id, (a = { best: Infinity, bestDiscount: 0, onSale: false }));
    if (live) a.onSale = true;
    if (value === undefined) continue;
    if (value < a.best) {
      a.best = value;
      a.bestDiscount = live ? r.discount : 0;
    }
    if (r.country === home) a.home = value;
  }
  aggCache.delete(key);
  aggCache.set(key, { version, window, agg });
  if (aggCache.size > AGG_CACHE_MAX) aggCache.delete(aggCache.keys().next().value!);
  return agg;
}

/** The ids that pass the price filters, in the asked-for order. Same rules as deals: best = cheapest after conversion. */
function rankByPrice(db: Db, q: DirectoryQuery, where: string, params: string[], regions: string[], home: string, fx: FxRates | undefined, now: number): string[] {
  const meta = all<{ id: string; rank: number | null; release_date: string | null; title_key: string }>(db, `SELECT id, rank, release_date, title_key FROM games WHERE ${where}`, ...params);
  const agg = priceAggregates(db, regions, home, q.currency, fx, now);
  const kept = meta.filter((g) => {
    const a = agg.get(g.id);
    if (q.onSale && !a?.onSale) return false;
    if (q.minDiscount && (a?.bestDiscount ?? 0) < q.minDiscount) return false;
    if (q.maxPrice !== undefined && !(a && a.best <= q.maxPrice)) return false;
    if (q.abroad && !(a?.home && a.best < Infinity && 1 - a.best / a.home >= q.abroad)) return false;
    return true;
  });
  const rankOf = (g: (typeof meta)[number]) => g.rank ?? Number.MAX_SAFE_INTEGER;
  const bestOf = (g: (typeof meta)[number]) => agg.get(g.id)?.best ?? Infinity;
  const discountOf = (g: (typeof meta)[number]) => agg.get(g.id)?.bestDiscount ?? 0;
  kept.sort((a, b) => {
    switch (q.sort) {
      case 'cheapest':
        return bestOf(a) - bestOf(b) || rankOf(a) - rankOf(b);
      case 'discount':
        return discountOf(b) - discountOf(a) || rankOf(a) - rankOf(b);
      case 'newest':
        return (b.release_date ?? '').localeCompare(a.release_date ?? '') || rankOf(a) - rankOf(b);
      case 'title':
        return a.title_key.localeCompare(b.title_key) || rankOf(a) - rankOf(b);
      default:
        return rankOf(a) - rankOf(b);
    }
  });
  return kept.map((g) => g.id);
}
