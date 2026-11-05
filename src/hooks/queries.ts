import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { fetchFx } from '../api/fx';
import { listSwitchGames, priceSwitchGames, getSwitchGame } from '../api/nintendo';
import type { EuSort } from '../api/nintendo/catalogEu';
import { getSteamGame, listSteamDeals, searchSteam, fetchSteamDetails, type SteamSort } from '../api/steam';
import { regionalPricesFor, switchCountries, type PriceContext } from '../api/prices';
import { steamStoreCountry } from '../domain/regions';
import type { Game, Platform, RegionPrice } from '../domain/types';
import { useSettings } from '../state/settings';
import { cachedGame, rememberGames } from '../state/gameCache';

export interface ListedGame {
  game: Game;
  prices: RegionPrice[];
}

export function usePriceContext(): PriceContext & { homeCurrency: string } {
  return useSettings(
    useShallow((s) => ({
      homeRegion: s.homeRegion,
      homeCurrency: s.homeCurrency,
      switchRegions: s.switchRegions,
      steamRegions: s.steamRegions,
    })),
  );
}

export function useFx() {
  return useQuery({
    queryKey: ['fx'],
    queryFn: fetchFx,
    staleTime: 6 * 3600 * 1000,
    gcTime: 24 * 3600 * 1000,
  });
}

export type DealSort = 'popular' | 'discount' | 'cheapest' | 'ending' | 'newest';

const EU_SORT: Record<DealSort, EuSort> = {
  popular: 'popular',
  discount: 'discount',
  cheapest: 'price',
  ending: 'popular',
  newest: 'newest',
};

const STEAM_SORT: Record<DealSort, SteamSort> = {
  popular: 'popular',
  discount: 'discount',
  cheapest: 'price',
  ending: 'popular',
  newest: 'newest',
};

const PAGE = 30;

/** Games currently on sale, priced across your regions. */
export function useDeals(platform: Platform, sort: DealSort) {
  const ctx = usePriceContext();
  const countries = switchCountries(ctx);
  const store = steamStoreCountry(ctx.homeRegion);
  return useInfiniteQuery({
    queryKey: ['deals', platform, sort, platform === 'steam' ? store.code : countries.join(',')],
    initialPageParam: 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async ({ pageParam }): Promise<{ items: ListedGame[]; hasMore: boolean; total: number }> => {
      if (platform === 'steam') {
        const res = await listSteamDeals({ country: store.code, currency: store.currency, sort: STEAM_SORT[sort], page: pageParam, pageSize: PAGE });
        rememberGames(res.games);
        return { items: res.games.map((g) => ({ game: g, prices: g.listPrice ? [g.listPrice] : [] })), hasMore: res.hasMore, total: res.total };
      }
      const res = await listSwitchGames({ platform, onSale: true, sort: EU_SORT[sort], page: pageParam, pageSize: PAGE });
      rememberGames(res.games);
      const prices = await priceSwitchGames(res.games, countries);
      return {
        items: res.games.map((g) => ({ game: g, prices: prices.get(g.key) ?? [] })),
        hasMore: res.hasMore,
        total: res.total,
      };
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
  });
}

export type DirectoryPlatform = Platform | 'all-switch';

/** The game directory: every game, with current prices per region. */
export function useDirectory(platform: DirectoryPlatform, query: string) {
  const ctx = usePriceContext();
  const countries = switchCountries(ctx);
  const store = steamStoreCountry(ctx.homeRegion);
  const q = query.trim();
  return useInfiniteQuery({
    queryKey: ['directory', platform, q, platform === 'steam' ? store.code : countries.join(',')],
    initialPageParam: 0,
    staleTime: 15 * 60 * 1000,
    enabled: platform !== 'steam' || q.length > 1,
    queryFn: async ({ pageParam }): Promise<{ items: ListedGame[]; hasMore: boolean; total: number }> => {
      if (platform === 'steam') {
        const games = await searchSteam(q, store.code);
        rememberGames(games);
        return { items: games.map((g) => ({ game: g, prices: g.listPrice ? [g.listPrice] : [] })), hasMore: false, total: games.length };
      }
      const res = await listSwitchGames({
        platform: platform === 'all-switch' ? 'all' : platform,
        query: q,
        sort: 'popular',
        page: pageParam,
        pageSize: PAGE,
      });
      rememberGames(res.games);
      const prices = await priceSwitchGames(res.games, countries);
      return { items: res.games.map((g) => ({ game: g, prices: prices.get(g.key) ?? [] })), hasMore: res.hasMore, total: res.total };
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
  });
}

/** A single game, from the session cache or looked up by its key. */
export function useGame(key: string, fallback?: Game) {
  const { homeRegion } = usePriceContext();
  const initial = fallback ?? cachedGame(key);
  return useQuery({
    queryKey: ['game', key],
    queryFn: async () => {
      const g = key.startsWith('steam:')
        ? await getSteamGame(key, steamStoreCountry(homeRegion).code)
        : await getSwitchGame(key);
      if (!g) throw new Error('Game not found');
      return g;
    },
    initialData: initial,
    staleTime: initial ? Infinity : 60 * 60 * 1000,
  });
}

export function useRegionalPrices(game: Game | undefined) {
  const ctx = usePriceContext();
  return useQuery({
    queryKey: ['regional', game?.key, ctx.homeRegion, ctx.switchRegions.join(','), ctx.steamRegions.join(',')],
    enabled: !!game,
    staleTime: 10 * 60 * 1000,
    queryFn: () => regionalPricesFor(game!, ctx),
  });
}

export function useSteamDetails(appId: number | undefined) {
  const { homeRegion } = usePriceContext();
  return useQuery({
    queryKey: ['steam-details', appId],
    enabled: !!appId,
    staleTime: 24 * 3600 * 1000,
    queryFn: () => fetchSteamDetails(appId!, steamStoreCountry(homeRegion).code),
  });
}
