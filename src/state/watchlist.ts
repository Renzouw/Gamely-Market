import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Game, PricePoint } from '../domain/types';
import { persistStorage } from './storage';

export interface WatchItem {
  game: Game;
  addedAt: number;
  /** Alert when the best price drops to or below this, in home currency */
  target?: number;
  /** Best price we saw last time, home currency */
  lastBest?: number;
  lastCountry?: string;
  /** Lowest price we have ever seen for this game while it was watched */
  lowest?: number;
  /** When we last sent a notification, so we don't repeat it every refresh */
  alertedAt?: number;
  history: PricePoint[];
}

const MAX_POINTS = 180;
/** Don't record more than one history point per game every 3 hours */
const MIN_GAP = 3 * 3600 * 1000;

interface WatchState {
  items: Record<string, WatchItem>;
  add: (game: Game, target?: number) => void;
  remove: (key: string) => void;
  setTarget: (key: string, target?: number) => void;
  /** Record a price observation. Returns true when the target was just hit. */
  record: (key: string, best: number, country: string, now?: number) => boolean;
  markAlerted: (key: string, now?: number) => void;
}

export function appendPoint(history: PricePoint[], point: PricePoint): PricePoint[] {
  const last = history[history.length - 1];
  if (last && point.t - last.t < MIN_GAP) {
    // Same window: keep the newest reading instead of adding a point
    return [...history.slice(0, -1), point];
  }
  return [...history, point].slice(-MAX_POINTS);
}

export function targetJustHit(item: WatchItem, best: number): boolean {
  if (item.target === undefined) return false;
  if (best > item.target) return false;
  // Only alert on the transition, or if the price dropped further since the last alert
  return item.lastBest === undefined || item.lastBest > item.target || best < item.lastBest;
}

export const useWatchlist = create<WatchState>()(
  persist(
    (set, get) => ({
      items: {},
      add: (game, target) =>
        set((s) => ({
          items: { ...s.items, [game.key]: s.items[game.key] ?? { game, addedAt: Date.now(), target, history: [] } },
        })),
      remove: (key) =>
        set((s) => {
          const { [key]: _, ...rest } = s.items;
          return { items: rest };
        }),
      setTarget: (key, target) =>
        set((s) => (s.items[key] ? { items: { ...s.items, [key]: { ...s.items[key], target, alertedAt: undefined } } } : s)),
      record: (key, best, country, now = Date.now()) => {
        const item = get().items[key];
        if (!item) return false;
        const hit = targetJustHit(item, best);
        set((s) => ({
          items: {
            ...s.items,
            [key]: {
              ...item,
              lastBest: best,
              lastCountry: country,
              lowest: item.lowest === undefined ? best : Math.min(item.lowest, best),
              history: appendPoint(item.history, { t: now, best, country }),
            },
          },
        }));
        return hit;
      },
      markAlerted: (key, now = Date.now()) =>
        set((s) => (s.items[key] ? { items: { ...s.items, [key]: { ...s.items[key], alertedAt: now } } } : s)),
    }),
    { name: 'gamely.watchlist', storage: persistStorage, version: 1 },
  ),
);
