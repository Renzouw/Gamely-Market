import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AlertPrefs, ApiActivity, ApiSaleEvent, ApiFx, ApiGame, ApiGameDetail, ApiList, ApiListItem, ApiStatus, ApiWatch, DealSort, WatchInput } from '@shared/api';
import { summarize, type PriceSummary } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import type { Platform, RegionPrice } from '@shared/types';
import { api } from '../api/client';
import { useSettings } from '../state/settings';

export function usePrefs() {
  return useSettings(
    useShallow((s) => ({ home: s.homeRegion, currency: s.homeCurrency, switchRegions: s.switchRegions, steamRegions: s.steamRegions })),
  );
}

export function useFx() {
  return useQuery({ queryKey: ['fx'], queryFn: () => api<ApiFx>('/v1/fx'), staleTime: 3 * 3600_000, gcTime: 48 * 3600_000 });
}

/** Store-wide sales happening right now. */
export function useSaleEvents() {
  return useQuery({ queryKey: ['events'], queryFn: () => api<{ items: ApiSaleEvent[] }>('/v1/events').then((r) => r.items), staleTime: 5 * 60_000 });
}

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => api<ApiStatus>('/v1/status'), staleTime: 60_000 });
}

const flatten = (data?: InfiniteData<ApiList>) => {
  const seen = new Set<string>();
  const items: ApiListItem[] = [];
  for (const page of data?.pages ?? []) for (const it of page.items) if (!seen.has(it.game.key)) (seen.add(it.game.key), items.push(it));
  return items;
};

export interface DealFilters {
  minDiscount?: number;
  maxPrice?: number;
  abroad?: number;
}

export function useDeals(platform: Platform, sort: DealSort, filters: DealFilters) {
  const p = usePrefs();
  const regions = platform === 'steam' ? p.steamRegions : p.switchRegions;
  const q = useInfiniteQuery({
    queryKey: ['deals', platform, sort, filters, p.home, p.currency, regions],
    initialPageParam: undefined as string | undefined,
    staleTime: 2 * 60_000,
    queryFn: ({ pageParam, signal }) =>
      api<ApiList>('/v1/deals', { query: { platform, sort, home: p.home, currency: p.currency, regions, cursor: pageParam, ...filters }, signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => flatten(q.data), [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total, checkedAt: q.data?.pages[0]?.checkedAt };
}

export type DirectoryPlatform = Platform | 'all-switch';

export function useDirectory(platform: DirectoryPlatform, query: string) {
  const p = usePrefs();
  const regions = platform === 'steam' ? p.steamRegions : p.switchRegions;
  const term = query.trim();
  const q = useInfiniteQuery({
    queryKey: ['games', platform, term, p.home, regions],
    initialPageParam: undefined as string | undefined,
    staleTime: 5 * 60_000,
    enabled: platform !== 'steam' || term.length >= 2,
    queryFn: ({ pageParam, signal }) => api<ApiList>('/v1/games', { query: { platform, q: term, home: p.home, regions, cursor: pageParam }, signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => flatten(q.data), [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total };
}

export function useGameDetail(key: string) {
  const p = usePrefs();
  const qc = useQueryClient();
  const isSteam = key.startsWith('steam:');
  return useQuery<ApiGameDetail>({
    queryKey: ['game', key, p.home, p.currency, isSteam ? p.steamRegions : p.switchRegions],
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api<ApiGameDetail>(`/v1/games/${encodeURIComponent(key)}`, {
        query: { home: p.home, currency: p.currency, regions: isSteam ? p.steamRegions : p.switchRegions },
        signal,
      }),
    // Show what the list already knew while the full page loads
    placeholderData: (): ApiGameDetail | undefined => {
      for (const [, data] of qc.getQueriesData<InfiniteData<ApiList>>({ queryKey: ['deals'] }).concat(qc.getQueriesData({ queryKey: ['games'] }))) {
        const hit = data?.pages?.flatMap((pg) => pg.items).find((i) => i.game.key === key);
        if (hit) return { game: hit.game, prices: hit.prices, lows: [], history: [], trackedSince: 0, unmatched: [], stale: false, placeholder: true } as ApiGameDetail;
      }
      return undefined;
    },
  });
}

/* --------------------------------- watches -------------------------------- */

export function useWatches() {
  return useQuery({ queryKey: ['watches'], queryFn: () => api<{ items: ApiWatch[] }>('/v1/watches', { auth: true }).then((r) => r.items), staleTime: 60_000 });
}

export function useIsWatched(key: string): ApiWatch | undefined {
  const { data } = useWatches();
  return data?.find((w) => w.game.key === key);
}

export function useWatchActions() {
  const qc = useQueryClient();
  const patch = (fn: (items: ApiWatch[]) => ApiWatch[]) => qc.setQueryData<ApiWatch[]>(['watches'], (old) => fn(old ?? []));

  const save = useMutation({
    mutationFn: ({ game, input }: { game: ApiGame; input: WatchInput }) =>
      api(`/v1/watches/${encodeURIComponent(game.key)}`, { method: 'PUT', body: input, auth: true }),
    onMutate: async ({ game, input }) => {
      await qc.cancelQueries({ queryKey: ['watches'] });
      const prev = qc.getQueryData<ApiWatch[]>(['watches']);
      patch((items) => {
        const existing = items.find((w) => w.game.key === game.key);
        const next: ApiWatch = {
          game,
          createdAt: existing?.createdAt ?? Date.now(),
          prices: existing?.prices ?? [],
          lowest: existing?.lowest,
          target: input.target === null ? undefined : (input.target ?? existing?.target),
          alerts: { ...(existing?.alerts ?? { sale: true, drop: false, target: true, low: true, ending: true }), ...(input.alerts ?? {}) } as AlertPrefs,
        };
        return existing ? items.map((w) => (w.game.key === game.key ? next : w)) : [next, ...items];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['watches'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['watches'] }),
  });

  const remove = useMutation({
    mutationFn: (key: string) => api(`/v1/watches/${encodeURIComponent(key)}`, { method: 'DELETE', auth: true }),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: ['watches'] });
      const prev = qc.getQueryData<ApiWatch[]>(['watches']);
      patch((items) => items.filter((w) => w.game.key !== key));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['watches'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['watches'] }),
  });

  return { save, remove };
}

export function useActivity() {
  return useQuery({ queryKey: ['activity'], queryFn: () => api<{ items: ApiActivity[] }>('/v1/activity', { auth: true }).then((r) => r.items), staleTime: 30_000 });
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
