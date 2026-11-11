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
  last?: {
    /** In the currency at the time; bestLocal is the same price in its own currency, for comparing across rate changes */
    best?: number;
    bestLocal?: { amount: number; currency: string };
    country?: string;
    /** Any region on sale (not just the cheapest) */
    onSale?: boolean;
    homeOnSale?: boolean;
    checkedAt: number;
  };
  /** Phone-side alerts already shown, so each one is shown once */
  sent: string[];
}

interface WatchState {
  items: Record<string, LocalWatch>;
  /** Removed here but not yet on the server */
  removed: string[];
  save: (game: ApiGame, input: WatchInput) => void;
  remove: (key: string) => void;
  /** Put back a watch exactly as it was (Undo after removing it) */
  restore: (w: LocalWatch) => void;
  markSynced: (key: string, version: number) => void;
  clearRemoved: (key: string) => void;
  /** Several at once: every change saves the whole watchlist to disk */
  setLastMany: (entries: { key: string; last: LocalWatch['last']; sent?: string[] }[]) => void;
  /** A currency change: targets converted at `rate` (new per old), or removed when there's no rate */
  convertTargets: (rate: number | undefined) => void;
}

export const useWatchlist = create<WatchState>()(
  persist(
    (set) => ({
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
      restore: (w) =>
        set((s) => ({
          items: { ...s.items, [w.game.key]: { ...w, synced: false, updatedAt: Date.now() } },
          removed: s.removed.filter((k) => k !== w.game.key),
        })),
      remove: (key) =>
        set((s) => {
          const { [key]: gone, ...rest } = s.items;
          return { items: rest, removed: gone && !s.removed.includes(key) ? [...s.removed, key] : s.removed };
        }),
      markSynced: (key, version) =>
        set((s) => (s.items[key] && s.items[key].updatedAt === version ? { items: { ...s.items, [key]: { ...s.items[key], synced: true } } } : s)),
      clearRemoved: (key) => set((s) => ({ removed: s.removed.filter((k) => k !== key) })),
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
      convertTargets: (rate) =>
        set((s) => ({
          items: Object.fromEntries(
            Object.entries(s.items).map(([k, w]) => [
              k,
              // Every watch forgets its last check (its numbers were in the old currency)
              w.target === undefined
                ? { ...w, last: undefined }
                : { ...w, target: rate ? Math.round(w.target * rate * 100) / 100 : undefined, synced: false, updatedAt: Date.now(), last: undefined },
            ]),
          ),
        })),
    }),
    { name: 'gamely.watchlist', storage: persistStorage, version: 1 },
  ),
);
