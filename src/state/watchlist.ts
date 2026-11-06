import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ALERTS, type AlertPrefs, type ApiGame, type WatchInput } from '@shared/api';
import { persistStorage } from './storage';

/**
 * The watchlist lives on the phone, so it works with or without the
 * server. Whenever the server is reachable, changes are synced to it so it
 * can send instant alerts.
 */
export interface LocalWatch {
  game: ApiGame;
  target?: number;
  alerts: AlertPrefs;
  createdAt: number;
  updatedAt: number;
  /** The server has this exact version */
  synced: boolean;
  /** What the phone saw last time it checked, for phone-side alerts */
  last?: { best?: number; country?: string; onSale?: boolean; homeOnSale?: boolean; checkedAt: number };
  /** Phone-side alerts already shown, so each one is shown once */
  sent: string[];
}

interface WatchState {
  items: Record<string, LocalWatch>;
  /** Removed here but not yet on the server */
  removed: string[];
  save: (game: ApiGame, input: WatchInput) => void;
  remove: (key: string) => void;
  markSynced: (key: string, version: number) => void;
  clearRemoved: (key: string) => void;
  setLast: (key: string, last: LocalWatch['last'], sent?: string[]) => void;
  /** Several at once: every change saves the whole watchlist to disk */
  setLastMany: (entries: { key: string; last: LocalWatch['last']; sent?: string[] }[]) => void;
  convertTargets: (rate: number) => void;
}

export const useWatchlist = create<WatchState>()(
  persist(
    (set, get) => ({
      items: {},
      removed: [],
      save: (game, input) =>
        set((s) => {
          const prev = s.items[game.key];
          const now = Date.now();
          const next: LocalWatch = {
            game,
            createdAt: prev?.createdAt ?? now,
            updatedAt: now,
            synced: false,
            target: input.target === null ? undefined : (input.target ?? prev?.target),
            alerts: { ...DEFAULT_ALERTS, ...prev?.alerts, ...input.alerts },
            last: prev?.last,
            sent: prev?.sent ?? [],
          };
          return { items: { ...s.items, [game.key]: next }, removed: s.removed.filter((k) => k !== game.key) };
        }),
      remove: (key) =>
        set((s) => {
          const { [key]: gone, ...rest } = s.items;
          return { items: rest, removed: gone && !s.removed.includes(key) ? [...s.removed, key] : s.removed };
        }),
      markSynced: (key, version) =>
        set((s) => (s.items[key] && s.items[key].updatedAt === version ? { items: { ...s.items, [key]: { ...s.items[key], synced: true } } } : s)),
      clearRemoved: (key) => set((s) => ({ removed: s.removed.filter((k) => k !== key) })),
      setLast: (key, last, sent) => get().setLastMany([{ key, last, sent }]),
      setLastMany: (entries) =>
        set((s) => {
          const items = { ...s.items };
          let changed = false;
          for (const { key, last, sent } of entries) {
            const w = items[key];
            if (!w) continue;
            items[key] = { ...w, last, sent: (sent ?? w.sent).slice(-40) };
            changed = true;
          }
          return changed ? { items } : s;
        }),
      /** Target prices follow a currency change (rate = new per old) */
      convertTargets: (rate) =>
        set((s) => ({
          items: Object.fromEntries(
            Object.entries(s.items).map(([k, w]) => [
              k,
              w.target === undefined ? w : { ...w, target: Math.round(w.target * rate * 100) / 100, synced: false, updatedAt: Date.now(), last: undefined },
            ]),
          ),
        })),
    }),
    { name: 'gamely.watchlist', storage: persistStorage, version: 1 },
  ),
);
