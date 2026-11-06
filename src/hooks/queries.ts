import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ApiActivity, ApiGame, ApiGameDetail, ApiList, ApiListItem, ApiStatus, ApiWatch, DealSort, DirectoryOptions, WatchInput } from '@shared/api';
import { summarize, type PriceSummary } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { Platform, RegionPrice } from '@shared/types';
import { api } from '../api/client';
import { getDeals, getEvents, getFx, getGame, getGames, getServerActivity, getWatchPrices } from '../api/data';
import { useServer, type DataMode } from '../api/server';
import { useLocalActivity } from '../state/activity';
import { useSettings } from '../state/settings';
import { useWatchlist } from '../state/watchlist';
import { syncWatches } from '../services/watchSync';

export function usePrefs() {
  return useSettings(
    useShallow((s) => ({ home: s.homeRegion, currency: s.homeCurrency, switchRegions: s.switchRegions, steamRegions: s.steamRegions })),
  );
}

/** Where data is coming from right now. Undefined for the first moment, while we look for the server. */
export function useDataMode(): DataMode | undefined {
  return useServer((s) => s.mode);
}

export function useFx() {
  const mode = useDataMode();
  // No mode passed: the key doesn't change with it, so this one falls back by itself
  return useQuery({ queryKey: ['fx'], queryFn: () => getFx(), enabled: !!mode, staleTime: 3 * 3600_000, gcTime: 48 * 3600_000 });
}

/** Store-wide sales happening right now (detected by the server; none in phone-only mode). */
export function useSaleEvents() {
  const mode = useDataMode();
  return useQuery({ queryKey: ['events', mode], queryFn: () => getEvents(mode), enabled: !!mode, staleTime: 5 * 60_000 });
}

export function useStatus() {
  const mode = useDataMode();
  return useQuery({ queryKey: ['status', mode], queryFn: () => api<ApiStatus>('/v1/status'), enabled: mode === 'server', staleTime: 60_000, retry: 0 });
}

const flatten = (data?: InfiniteData<ApiList>) => {
  const seen = new Set<string>();
  const items: ApiListItem[] = [];
  for (const page of data?.pages ?? []) {
    for (const it of page.items) {
      if (seen.has(it.game.key)) continue;
      seen.add(it.game.key);
      items.push(it);
    }
  }
  return items;
};

export interface DealFilters {
  minDiscount?: number;
  maxPrice?: number;
  abroad?: number;
  /** Just this one eShop */
  country?: string;
}

const keepSamePlatform =
  (platform: string) =>
  (prev: InfiniteData<ApiList, string | undefined> | undefined, prevQuery?: { queryKey: readonly unknown[] }) =>
    prevQuery?.queryKey[1] === platform ? prev : undefined;

export function useDeals(platform: Platform, sort: DealSort, filters: DealFilters) {
  const p = usePrefs();
  const mode = useDataMode();
  const fx = useFx().data;
  const regions = platform === 'steam' ? p.steamRegions : p.switchRegions;
  const q = useInfiniteQuery({
    queryKey: ['deals', platform, sort, filters, p.home, p.currency, regions, mode],
    initialPageParam: undefined as string | undefined,
    // Changing sort or a filter keeps the old list on screen until the new one arrives,
    // but switching platform never shows the previous platform's games
    placeholderData: keepSamePlatform(platform),
    enabled: !!mode,
    staleTime: 2 * 60_000,
    queryFn: ({ pageParam, signal }) => getDeals({ platform, sort, home: p.home, currency: p.currency, regions, cursor: pageParam, ...filters }, fx, mode, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => flatten(q.data), [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total, checkedAt: q.data?.pages[0]?.checkedAt };
}

export type DirectoryPlatform = Platform | 'all-switch';

export function useDirectory(platform: DirectoryPlatform, query: string, options: DirectoryOptions = {}) {
  const p = usePrefs();
  const mode = useDataMode();
  const fx = useFx().data;
  const regions = platform === 'steam' ? p.steamRegions : p.switchRegions;
  const term = query.trim();
  // Steam search has no sort or filters: it charges your account's country anyway
  const opts = platform === 'steam' ? {} : options;
  const q = useInfiniteQuery({
    queryKey: ['games', platform, term, p.home, p.currency, regions, opts, mode],
    initialPageParam: undefined as string | undefined,
    // Keep results visible while typing, within the same platform
    placeholderData: keepSamePlatform(platform),
    staleTime: 5 * 60_000,
    enabled: !!mode && (platform !== 'steam' || term.length >= 2),
    queryFn: ({ pageParam, signal }) => getGames(platform, term, regions, opts, fx, pageParam, mode, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => flatten(q.data), [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total };
}

export function useGameDetail(key: string) {
  const p = usePrefs();
  const qc = useQueryClient();
  const mode = useDataMode();
  const fx = useFx().data;
  const watched = useWatchlist((s) => s.items[key]?.game);
  const isSteam = key.startsWith('steam:');
  const regions = isSteam ? p.steamRegions : p.switchRegions;

  // What the lists already know about this game: shown instantly, and lets
  // phone-only mode skip a catalog lookup
  const fromLists = (): ApiListItem | undefined => {
    for (const [, data] of qc.getQueriesData<InfiniteData<ApiList>>({ queryKey: ['deals'] }).concat(qc.getQueriesData({ queryKey: ['games'] }))) {
      const hit = data?.pages?.flatMap((pg) => pg.items).find((i) => i.game.key === key);
      if (hit) return hit;
    }
    return undefined;
  };

  return useQuery<ApiGameDetail>({
    queryKey: ['game', key, p.home, p.currency, regions, mode],
    enabled: !!mode,
    staleTime: 60_000,
    queryFn: ({ signal }) => getGame(key, regions, fx, fromLists()?.game ?? watched, mode, signal),
    placeholderData: (): ApiGameDetail | undefined => {
      const hit = fromLists();
      if (hit) return { game: hit.game, prices: hit.prices, lows: [], history: [], trackedSince: 0, unmatched: [], stale: false, placeholder: true } as ApiGameDetail;
      return undefined;
    },
  });
}

/* --------------------------------- watches -------------------------------- */

/**
 * The watchlist: membership, targets and alert settings come from the
 * phone; prices come from the server or the stores.
 */
export function useWatches() {
  const items = useWatchlist((s) => s.items);
  const mode = useDataMode();
  const fx = useFx().data;
  const p = usePrefs();
  const list = useMemo(() => Object.values(items).sort((a, b) => b.createdAt - a.createdAt), [items]);
  const keys = list.map((w) => w.game.key).join(',');
  const prices = useQuery({
    queryKey: ['watches', mode, keys, p.home, p.currency, p.switchRegions, p.steamRegions],
    enabled: !!mode && list.length > 0,
    staleTime: 60_000,
    queryFn: () => getWatchPrices(list.map((w) => w.game), fx, mode),
  });
  const data = useMemo<ApiWatch[]>(
    () =>
      list.map((w) => ({
        game: w.game,
        target: w.target,
        alerts: w.alerts,
        createdAt: w.createdAt,
        prices: prices.data?.[w.game.key]?.prices ?? [],
        lowest: prices.data?.[w.game.key]?.lowest,
      })),
    [list, prices.data],
  );
  return { ...prices, data, isPending: list.length > 0 && prices.isPending };
}

export function useIsWatched(key: string): ApiWatch | undefined {
  const w = useWatchlist((s) => s.items[key]);
  return useMemo(() => (w ? { game: w.game, target: w.target, alerts: w.alerts, createdAt: w.createdAt, prices: [] } : undefined), [w]);
}

/** Changes apply on the phone at once and reach the server on the next sync. */
export function useWatchActions() {
  return useMemo(
    () => ({
      save: {
        mutate: ({ game, input }: { game: ApiGame; input: WatchInput }) => {
          useWatchlist.getState().save(game, input);
          void syncWatches();
        },
      },
      remove: {
        mutate: (key: string) => {
          useWatchlist.getState().remove(key);
          void syncWatches();
        },
      },
    }),
    [],
  );
}

/** Alerts from the server (when reachable) and from the phone's own checks, newest first. */
export function useActivity() {
  const mode = useDataMode();
  const local = useLocalActivity((s) => s.items);
  const server = useQuery({ queryKey: ['activity', mode], queryFn: getServerActivity, enabled: mode === 'server', staleTime: 30_000 });
  const data = useMemo<ApiActivity[]>(() => [...(server.data ?? []), ...local].sort((a, b) => b.createdAt - a.createdAt), [server.data, local]);
  return { ...server, data, isPending: mode === 'server' ? server.isPending : false, isError: server.isError && !local.length };
}

/* --------------------------------- pricing -------------------------------- */

/** Best price, home price and savings for a game in the user's own currency. */
export function usePriceSummary(platform: Platform, prices: RegionPrice[]): PriceSummary & { currency: string } {
  const { currency, home } = usePrefs();
  const fx = useFx().data;
  return useMemo(() => {
    const homeRegion = platform === 'steam' ? steamStoreCountry(home).code : home;
    return { ...summarize(prices, { homeCurrency: currency, homeRegion, fx }), currency };
  }, [prices, currency, home, fx, platform]);
}
