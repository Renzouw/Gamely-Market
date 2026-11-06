/**
 * Phone-only mode: the same data the Gamely server provides, fetched
 * straight from the stores by the phone. Used whenever the server isn't
 * reachable. Results use the server's API shapes, so screens don't care
 * which mode they're in.
 *
 * What's different from the server: the Americas, Japan, Hong Kong and
 * Korea are matched by the server from catalogs too big for a phone. The
 * phone keeps a copy of those matches (state/links.ts, refreshed daily while
 * the server is reachable) and prices those regions itself with them. Games
 * listed only in the Americas need the server. Price history is what this
 * phone has seen.
 */
import type { ApiFx, ApiGame, ApiGameDetail, ApiList, ApiListItem, ApiPrice, DealQuery, DirectoryOptions, DirectorySort } from '@shared/api';
import { dailyBest } from '@shared/history';
import { convert, summarize } from '@shared/pricing';
import { HOME_CURRENCIES, STEAM_REGIONS, SWITCH_REGIONS, steamStoreCountry } from '@shared/regions';
import { FX_FALLBACK, FX_PRIMARY, mergeFx, quotesToRates, type ErApiResponse, type FrankfurterResponse } from '@shared/stores/fx';
import {
  euByNsuidQuery,
  euSearchQuery,
  NINTENDO_EU_SEARCH,
  NINTENDO_PRICE,
  parseEuResponse,
  parsePriceResponse,
  PRICE_BATCH,
  priceQuery,
  type EuResponse,
  type EuSort,
  type RawPriceResponse,
} from '@shared/stores/nintendo';
import {
  parsePriceOverview,
  parseSearchHtml,
  parseStoreSearch,
  steamGame,
  steamSearchQuery,
  STEAM_STORE_PUBLIC,
  type AppDetailsFull,
  type AppDetailsPriceResponse,
  type SearchResultsResponse,
  type SteamSort,
  type StoreSearchResponse,
} from '@shared/stores/steam';
import type { FxRates, Game, RegionPrice, ShopGroup } from '@shared/types';
import { chunk, getJson, qs, StoreError } from './http';
import { localLows, useLocalHistory } from './history';
import { withKnownIds } from '../state/links';

export interface DirectContext {
  home: string;
  currency: string;
  switchRegions: string[];
  steamRegions: string[];
}

const PAGE = 30;

/* --------------------------------- regions --------------------------------- */

/** Switch countries phone-only mode can price for any game: the Europe/Oceania group you buy from. */
export function directSwitchCountries(ctx: DirectContext): string[] {
  const wanted = new Set([...ctx.switchRegions, ctx.home]);
  return SWITCH_REGIONS.filter((r) => r.group === 'europe' && wanted.has(r.code)).map((r) => r.code);
}

/**
 * Every Switch country phone-only mode can price: Europe, plus the regions
 * the server matched, once the phone holds a copy of those matches.
 */
export function directPricedCountries(ctx: DirectContext, haveMatches: boolean): string[] {
  const wanted = new Set([...ctx.switchRegions, ctx.home]);
  return SWITCH_REGIONS.filter((r) => wanted.has(r.code) && (r.group === 'europe' || (haveMatches && (SERVER_MATCHED as readonly string[]).includes(r.group)))).map((r) => r.code);
}

function steamCountries(ctx: DirectContext): { code: string; currency: string }[] {
  const store = steamStoreCountry(ctx.home);
  const codes = new Set([store.code, ...ctx.steamRegions]);
  return STEAM_REGIONS.filter((r) => codes.has(r.code)).map((r) => ({ code: r.code, currency: r.currency }));
}

/* ----------------------------------- fx ------------------------------------ */

const WANTED = [...new Set([...HOME_CURRENCIES, ...SWITCH_REGIONS.map((r) => r.currency), ...STEAM_REGIONS.map((r) => r.currency)])];

export async function directFx(): Promise<ApiFx> {
  const ecb = await getJson<FrankfurterResponse>(`${FX_PRIMARY}?base=USD`);
  const missing = WANTED.filter((c) => c !== 'USD' && !ecb.rates?.[c]);
  const market = missing.length ? await getJson<ErApiResponse>(FX_FALLBACK).catch(() => undefined) : undefined;
  return quotesToRates(mergeFx(ecb, market, WANTED));
}

/* -------------------------------- Nintendo --------------------------------- */

async function searchEu(p: Parameters<typeof euSearchQuery>[0]) {
  return parseEuResponse(await getJson<EuResponse>(`${NINTENDO_EU_SEARCH}?${qs(euSearchQuery(p))}`));
}

/** One country's prices for many games. Failures surface so we never show "not sold" by mistake. */
async function countryPrices(country: string, nsuids: string[]): Promise<Map<string, RegionPrice>> {
  const out = new Map<string, RegionPrice>();
  for (const ids of chunk([...new Set(nsuids)], PRICE_BATCH)) {
    const data = await getJson<RawPriceResponse>(`${NINTENDO_PRICE}?${qs(priceQuery(country, ids))}`);
    parsePriceResponse(country, data).prices.forEach((v, k) => out.set(k, v));
  }
  return out;
}

/**
 * Groups with their own IDs that only the server can match. The phone
 * prices them itself with IDs the server already found (state/links.ts).
 */
const SERVER_MATCHED = ['americas', 'japan', 'hongkong', 'korea'] as const satisfies readonly Exclude<ShopGroup, 'steam'>[];

/** Countries this person compares in those groups. */
function serverMatchedRegions(ctx: DirectContext) {
  return SWITCH_REGIONS.filter((r) => (SERVER_MATCHED as readonly string[]).includes(r.group) && ctx.switchRegions.includes(r.code));
}

/* ---------------------------------- Steam ---------------------------------- */

async function steamCountryPrices(appIds: number[], country: string): Promise<Map<number, RegionPrice>> {
  const out = new Map<number, RegionPrice>();
  for (const ids of chunk([...new Set(appIds)], 40)) {
    const d = await getJson<AppDetailsPriceResponse>(`${STEAM_STORE_PUBLIC}/api/appdetails?${qs({ appids: ids.join(','), cc: country, filters: 'price_overview' })}`);
    parsePriceOverview(country, d).forEach((v, k) => out.set(k, v));
  }
  return out;
}

/* --------------------------------- pricing --------------------------------- */

function toApiGame(g: Game, prices: RegionPrice[], now = Date.now()): ApiGame {
  const live = prices.filter((p) => p.sale && (!p.saleEndsAt || Date.parse(p.saleEndsAt) > now));
  const ends = live.map((p) => p.saleEndsAt).filter((e): e is string => !!e).sort()[0];
  return { ...g, onSale: live.length > 0, maxDiscount: Math.max(0, ...live.map((p) => p.discountPercent)), saleEndsAt: ends };
}

const stamp = (p: RegionPrice, t: number): ApiPrice => ({ ...p, checkedAt: t });

/**
 * Prices for a set of games in every country this person compares. A
 * country that fails is skipped; if every country fails, it's an error.
 */
export async function directPrices(list: Pick<Game, 'key' | 'platform' | 'nsuids' | 'steamAppId'>[], ctx: DirectContext): Promise<Map<string, ApiPrice[]>> {
  const now = Date.now();
  const games = await withKnownIds(list);
  const out = new Map<string, ApiPrice[]>(games.map((g) => [g.key, []]));
  const tasks: Promise<boolean>[] = [];

  // Switch: one request per country covers up to 50 games
  const byNsuid = new Map<string, string>();
  for (const g of games) {
    if (g.platform === 'steam') continue;
    if (g.nsuids?.europe) byNsuid.set(g.nsuids.europe, g.key);
  }
  const add = (key: string | undefined, p: RegionPrice) => key && out.get(key)?.push(stamp(p, now));
  if (byNsuid.size) {
    for (const c of directSwitchCountries(ctx)) {
      tasks.push(countryPrices(c, [...byNsuid.keys()]).then((m) => (m.forEach((p, id) => add(byNsuid.get(id), p)), true), () => false));
    }
  }
  // Japan, Hong Kong, Korea: only for games the server already matched there
  for (const r of serverMatchedRegions(ctx)) {
    const ids = new Map<string, string>();
    for (const g of games) {
      const id = g.platform !== 'steam' ? g.nsuids?.[r.group] : undefined;
      if (id) ids.set(id, g.key);
    }
    if (ids.size) tasks.push(countryPrices(r.code, [...ids.keys()]).then((m) => (m.forEach((p, id) => add(ids.get(id), p)), true), () => false));
  }

  // Steam: one request per country covers up to 40 games
  const byApp = new Map<number, string>(games.filter((g) => g.platform === 'steam' && g.steamAppId).map((g) => [g.steamAppId!, g.key]));
  if (byApp.size) {
    for (const c of steamCountries(ctx)) {
      tasks.push(steamCountryPrices([...byApp.keys()], c.code).then((m) => (m.forEach((p, id) => add(byApp.get(id), p)), true), () => false));
    }
  }

  const results = await Promise.all(tasks);
  if (results.length && !results.some(Boolean)) throw new StoreError('The stores aren’t answering right now. Check your connection.');
  return out;
}

/* ---------------------------------- lists ---------------------------------- */

const EU_SORT: Record<DealQuery['sort'], EuSort> = { popular: 'popular', discount: 'discount', cheapest: 'price', ending: 'popular', newest: 'newest' };
const STEAM_SORT: Record<DealQuery['sort'], SteamSort> = { popular: 'popular', discount: 'discount', cheapest: 'price', ending: 'popular', newest: 'newest' };

function rankPage(items: ApiListItem[], q: DealQuery, fx: FxRates | undefined, home: string, saleRegions: Set<string>): ApiListItem[] {
  const scored = items
    .filter((it) => it.prices.some((p) => p.sale && saleRegions.has(p.country)))
    .map((it) => ({ it, s: summarize(it.game.platform === 'steam' ? it.prices.filter((p) => p.country === home) : it.prices, { homeCurrency: q.currency, homeRegion: home, fx }) }))
    .filter(({ s }) => !q.minDiscount || (s.best?.discountPercent ?? 0) >= q.minDiscount)
    .filter(({ s }) => q.maxPrice === undefined || (s.best?.converted !== undefined && s.best.converted <= q.maxPrice))
    .filter(({ s }) => !q.abroad || (s.savingVsHome ?? 0) >= q.abroad);
  const end = (x: (typeof scored)[number]) => Date.parse(x.s.best?.saleEndsAt ?? '') || Infinity;
  if (q.sort === 'ending') scored.sort((a, b) => end(a) - end(b));
  if (q.sort === 'cheapest') scored.sort((a, b) => (a.s.best?.converted ?? Infinity) - (b.s.best?.converted ?? Infinity));
  if (q.sort === 'discount') scored.sort((a, b) => (b.s.best?.discountPercent ?? 0) - (a.s.best?.discountPercent ?? 0));
  return scored.map((x) => x.it);
}

export async function directDeals(q: DealQuery, ctx: DirectContext, fx: FxRates | undefined): Promise<ApiList> {
  const page = Math.max(0, Math.floor(Number(q.cursor ?? 0)) || 0);
  const now = Date.now();
  if (q.platform === 'steam') {
    const store = steamStoreCountry(ctx.home);
    const query = steamSearchQuery({ country: store.code, sort: STEAM_SORT[q.sort], page, pageSize: PAGE });
    const data = await getJson<SearchResultsResponse>(`${STEAM_STORE_PUBLIC}/search/results/?${qs(query)}`);
    const games = parseSearchHtml(data.results_html ?? '', store.currency, store.code);
    const items = games.map((g) => ({ game: toApiGame(g, g.listPrice ? [g.listPrice] : []), prices: g.listPrice ? [stamp(g.listPrice, now)] : [] }));
    const total = data.total_count ?? games.length;
    return { items: rankPage(items, q, fx, store.code, new Set([store.code])), total, nextCursor: query.start + games.length < total ? String(page + 1) : undefined, checkedAt: now };
  }
  // One country picked: only that eShop counts, as on the server
  const c = q.country ? onlyCountry(ctx, q.country) : ctx;
  const found = await searchEu({ platform: q.platform, onSale: true, sort: EU_SORT[q.sort], page, pageSize: PAGE });
  const { total } = found;
  // Carry the server's matches on each game, so its page can price those regions too
  const games = await withKnownIds(found.games);
  const prices = await directPrices(games, c);
  const items = games.map((g) => ({ game: toApiGame(g, prices.get(g.key) ?? []), prices: prices.get(g.key) ?? [] }));
  // A sale counts in any country we priced (regions without stored matches simply have no prices)
  const countries = new Set(directPricedCountries(c, true));
  return { items: rankPage(items, q, fx, c.home, countries), total, nextCursor: (page + 1) * PAGE < total ? String(page + 1) : undefined, checkedAt: now };
}

function onlyCountry(ctx: DirectContext, country: string): DirectContext {
  return { ...ctx, home: country, switchRegions: [country] };
}

const EU_DIRECTORY_SORT: Record<DirectorySort, EuSort> = { popular: 'popular', cheapest: 'price', discount: 'discount', newest: 'newest', title: 'title' };

export async function directGames(
  platform: 'switch' | 'switch2' | 'steam' | 'all-switch',
  term: string,
  ctx: DirectContext,
  cursor?: string,
  opts: DirectoryOptions = {},
  fx?: FxRates,
): Promise<ApiList> {
  const { country } = opts;
  const now = Date.now();
  if (platform === 'steam') {
    const store = steamStoreCountry(ctx.home);
    const data = await getJson<StoreSearchResponse>(`${STEAM_STORE_PUBLIC}/api/storesearch/?${qs({ term, l: 'english', cc: store.code })}`);
    const games = parseStoreSearch(data, store.code);
    return { items: games.map((g) => ({ game: toApiGame(g, g.listPrice ? [g.listPrice] : []), prices: g.listPrice ? [stamp(g.listPrice, now)] : [] })), total: games.length, checkedAt: now };
  }
  const page = Math.max(0, Math.floor(Number(cursor ?? 0)) || 0);
  // Europe's catalog sorts and finds sales itself; price filters then apply to each page
  const c = country ? onlyCountry(ctx, country) : ctx;
  const found = await searchEu({
    platform: platform === 'all-switch' ? 'all' : platform,
    query: term,
    onSale: opts.onSale,
    sort: EU_DIRECTORY_SORT[opts.sort ?? 'popular'],
    page,
    pageSize: PAGE,
  });
  const { total } = found;
  const games = await withKnownIds(found.games);
  const prices = await directPrices(games, c);
  const items = games
    .map((g) => ({ game: toApiGame(g, prices.get(g.key) ?? []), prices: prices.get(g.key) ?? [] }))
    // With a country picked, only games that eShop sells
    .filter((i) => !country || i.prices.length)
    .filter((i) => {
      if (opts.onSale && !i.prices.some((p) => p.sale)) return false;
      if (!opts.minDiscount && opts.maxPrice === undefined && !opts.abroad) return true;
      const s = summarize(i.prices, { homeCurrency: ctx.currency, homeRegion: c.home, fx });
      if (opts.minDiscount && (s.best?.discountPercent ?? 0) < opts.minDiscount) return false;
      if (opts.maxPrice !== undefined && !(s.best?.converted !== undefined && s.best.converted <= opts.maxPrice)) return false;
      if (opts.abroad && (s.savingVsHome ?? 0) < opts.abroad) return false;
      return true;
    });
  return {
    items,
    total,
    nextCursor: (page + 1) * PAGE < total ? String(page + 1) : undefined,
    checkedAt: now,
  };
}

/* -------------------------------- game page -------------------------------- */

async function lookupGame(key: string): Promise<Game | undefined> {
  const [kind, src, id] = key.split(':');
  if (kind === 'sw' && src === 'eu') {
    const { games } = parseEuResponse(await getJson<EuResponse>(`${NINTENDO_EU_SEARCH}?${qs(euByNsuidQuery(id))}`));
    return games[0];
  }
  if (kind === 'steam') {
    const appId = Number(src);
    const data = await getJson<AppDetailsFull>(`${STEAM_STORE_PUBLIC}/api/appdetails?${qs({ appids: appId, l: 'english' })}`);
    const d = data[String(appId)]?.data;
    return d ? steamGame(appId, d.name, { image: d.header_image, publisher: d.publishers?.[0], releaseDate: d.release_date?.date }) : undefined;
  }
  return undefined; // Americas-only listings need the server
}

export async function directGameDetail(key: string, ctx: DirectContext, fx: FxRates | undefined, known?: Game): Promise<ApiGameDetail> {
  const found = known ?? (await lookupGame(key));
  if (!found) throw new StoreError('This game needs your Gamely server, which isn’t reachable right now.');
  const [game] = await withKnownIds([found]);

  // Regions the server hasn't matched this game in (or we have no copy of its matches yet)
  const unmatched: ApiGameDetail['unmatched'] =
    game.platform === 'steam' ? [] : [...new Set(serverMatchedRegions(ctx).map((r) => r.group))].filter((grp) => !game.nsuids?.[grp]);

  const prices = (await directPrices([game], ctx)).get(key) ?? [];
  const history = useLocalHistory.getState();
  history.record(key, prices);
  const rec = useLocalHistory.getState().games[key];
  const regions = new Set(prices.map((p) => p.country));
  const rows = (rec?.rows ?? []).filter((r) => regions.has(r.country));
  const lows = localLows(rows);
  let lowest: ApiGameDetail['lowest'];
  for (const l of lows) {
    const v = convert(l.price, l.currency, ctx.currency, fx);
    if (v !== undefined && (!lowest || v < lowest.price)) lowest = { price: Math.round(v * 100) / 100, country: l.country, at: l.at };
  }
  return {
    game: toApiGame(game, prices),
    prices,
    lows,
    history: dailyBest(rows, ctx.currency, fx),
    lowest,
    trackedSince: rec?.firstSeen ?? Date.now(),
    unmatched,
    stale: false,
  };
}
