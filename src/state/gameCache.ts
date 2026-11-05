import type { Game } from '../domain/types';

/**
 * Games seen in lists this session, so opening a detail screen is instant
 * and doesn't need a second catalog lookup.
 */
const cache = new Map<string, Game>();

export function rememberGames(games: Game[]) {
  for (const g of games) {
    const prev = cache.get(g.key);
    cache.set(g.key, prev ? { ...prev, ...g, nsuids: { ...prev.nsuids, ...g.nsuids } } : g);
  }
}

export function cachedGame(key: string): Game | undefined {
  return cache.get(key);
}
