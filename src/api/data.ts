import type { ApiActivity, ApiFx, ApiGame, ApiGameDetail, ApiList, ApiPrice, ApiSaleEvent, ApiWatch, DealQuery, DirectoryOptions } from '@shared/api';
import { convert } from '@shared/pricing';
import type { FxRates, Game } from '@shared/types';
import { directDeals, directFx, directGameDetail, directGames, directPrices, type DirectContext } from '../direct';
import { localLows, useLocalHistory } from '../direct/history';
import { useSettings } from '../state/settings';
import { api, ApiError } from './client';
import { currentMode, reportServerDown, type DataMode } from './server';

/**
 * Every read goes through here. With the server reachable, data comes from
 * it; otherwise (or if it stops answering mid-request) the phone asks the
 * stores directly.
 */

export function directContext(): DirectContext {
  const s = useSettings.getState();
  return { home: s.homeRegion, currency: s.homeCurrency, switchRegions: s.switchRegions, steamRegions: s.steamRegions };
}

const serverUnavailable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500);

async function route<T>(mode: DataMode | undefined, server: () => Promise<T>, local: () => Promise<T>): Promise<T> {
  if ((mode ?? (await currentMode())) !== 'server') return local();
  try {
    return await server();
  } catch (e) {
    if (!serverUnavailable(e)) throw e;
    reportServerDown();
    return local();
  }
}

export const getFx = (mode?: DataMode) => route<ApiFx>(mode, () => api<ApiFx>('/v1/fx'), directFx);

export const getEvents = (mode?: DataMode) =>
  route<ApiSaleEvent[]>(mode, () => api<{ items: ApiSaleEvent[] }>('/v1/events').then((r) => r.items), async () => []);

export function getDeals(q: DealQuery, fx: FxRates | undefined, mode?: DataMode, signal?: AbortSignal) {
  const { platform, sort, home, currency, regions, cursor, minDiscount, maxPrice, abroad, country } = q;
  return route<ApiList>(
    mode,
    () => api<ApiList>('/v1/deals', { query: { platform, sort, home, currency, regions, cursor, minDiscount, maxPrice, abroad, country }, signal }),
    () => directDeals(q, directContext(), fx),
  );
}

export function getGames(
  platform: 'switch' | 'switch2' | 'steam' | 'all-switch',
  term: string,
  regions: string[],
  opts: DirectoryOptions,
  fx: FxRates | undefined,
  cursor?: string,
  mode?: DataMode,
  signal?: AbortSignal,
) {
  const ctx = directContext();
  const { sort, onSale, minDiscount, maxPrice, abroad, country } = opts;
  return route<ApiList>(
    mode,
    () =>
      api<ApiList>('/v1/games', {
        query: { platform, q: term, home: ctx.home, currency: ctx.currency, regions, country, sort, onSale: onSale ? '1' : undefined, minDiscount, maxPrice, abroad, cursor },
        signal,
      }),
    () => directGames(platform, term, ctx, cursor, opts, fx),
  );
}

export function getGame(key: string, regions: string[], fx: FxRates | undefined, known?: Game, mode?: DataMode, signal?: AbortSignal) {
  const ctx = directContext();
  return route<ApiGameDetail>(
    mode,
    () => api<ApiGameDetail>(`/v1/games/${encodeURIComponent(key)}`, { query: { home: ctx.home, currency: ctx.currency, regions }, signal }),
    () => directGameDetail(key, ctx, fx, known),
  );
}

export interface WatchPrices {
  prices: ApiPrice[];
  lowest?: ApiWatch['lowest'];
}

function lowestFromHistory(key: string, currency: string, fx: FxRates | undefined, regions: Set<string>): ApiWatch['lowest'] {
  const rows = (useLocalHistory.getState().games[key]?.rows ?? []).filter((r) => regions.has(r.country));
  let lowest: ApiWatch['lowest'];
  for (const l of localLows(rows)) {
    const v = convert(l.price, l.currency, currency, fx);
    if (v !== undefined && (!lowest || v < lowest.price)) lowest = { price: Math.round(v * 100) / 100, country: l.country, at: l.at };
  }
  return lowest;
}

/**
 * Current prices for watched games, recorded into the phone's history either way.
 * A plain object (not a Map), because it's saved to disk for instant starts.
 */
export async function getWatchPrices(games: ApiGame[], fx: FxRates | undefined, mode?: DataMode): Promise<Record<string, WatchPrices>> {
  const ctx = directContext();
  const viaPhone = async (list: ApiGame[]) => {
    const out: Record<string, WatchPrices> = {};
    if (!list.length) return out;
    const prices = await directPrices(list, ctx);
    for (const g of list) {
      const p = prices.get(g.key) ?? [];
      useLocalHistory.getState().record(g.key, p);
      out[g.key] = { prices: p, lowest: lowestFromHistory(g.key, ctx.currency, fx, new Set(p.map((x) => x.country))) };
    }
    return out;
  };
  return route(
    mode,
    async () => {
      const server = await api<{ items: ApiWatch[] }>('/v1/watches', { auth: true });
      const out: Record<string, WatchPrices> = Object.fromEntries(server.items.map((w) => [w.game.key, { prices: w.prices, lowest: w.lowest }]));
      for (const [key, v] of Object.entries(out)) useLocalHistory.getState().record(key, v.prices);
      // Games watched since the last sync aren't on the server yet
      const missing = games.filter((g) => !out[g.key]);
      if (missing.length) Object.assign(out, await viaPhone(missing).catch(() => ({})));
      return out;
    },
    () => viaPhone(games),
  );
}

export const getServerActivity = () => api<{ items: ApiActivity[] }>('/v1/activity', { auth: true }).then((r) => r.items);
