import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HistoryRow } from '@shared/history';
import { convert } from '@shared/pricing';
import type { FxRates, RegionPrice } from '@shared/types';
import { persistStorage } from '../state/storage';

/**
 * Price history kept on the phone, for phone-only mode. Like the server, it
 * stores a row only when a price changes, and keeps the most recently seen
 * games so it stays small.
 */
const MAX_GAMES = 250;
const MAX_ROWS_PER_GAME = 400;

interface GameHistory {
  firstSeen: number;
  touched: number;
  rows: HistoryRow[];
  /** Last price per country, to spot changes */
  last: Record<string, { currency: string; price: number }>;
}

interface HistoryState {
  games: Record<string, GameHistory>;
  record: (key: string, prices: RegionPrice[], now?: number) => void;
  /** Several games in one write: every write saves the whole history to disk */
  recordMany: (entries: [key: string, prices: RegionPrice[]][], now?: number) => void;
}

function addRows(games: Record<string, GameHistory>, key: string, prices: RegionPrice[], now: number) {
  const g: GameHistory = games[key] ?? { firstSeen: now, touched: now, rows: [], last: {} };
  const rows = [...g.rows];
  const last = { ...g.last };
  for (const p of prices) {
    const current = p.sale?.amount ?? p.regular.amount;
    const prev = last[p.country];
    if (!prev || prev.currency !== p.regular.currency || Math.abs(prev.price - current) > 0.004) {
      rows.push({ country: p.country, t: now, currency: p.regular.currency, price: current, discount: p.discountPercent });
      last[p.country] = { currency: p.regular.currency, price: current };
    }
  }
  games[key] = { firstSeen: g.firstSeen, touched: now, rows: rows.slice(-MAX_ROWS_PER_GAME), last };
}

export const useLocalHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      games: {},
      record: (key, prices, now) => get().recordMany([[key, prices]], now),
      recordMany: (entries, now = Date.now()) =>
        set((s) => {
          if (!entries.length) return s;
          const games = { ...s.games };
          for (const [key, prices] of entries) addRows(games, key, prices, now);
          const keys = Object.keys(games);
          if (keys.length > MAX_GAMES) {
            keys
              .sort((a, b) => games[a].touched - games[b].touched)
              .slice(0, keys.length - MAX_GAMES)
              .forEach((k) => delete games[k]);
          }
          return { games };
        }),
    }),
    { name: 'gamely.history', storage: persistStorage, version: 1 },
  ),
);

/** Lowest price seen per country, in that country's currency. */
export function localLows(rows: HistoryRow[]): { country: string; currency: string; price: number; at: number }[] {
  const lows = new Map<string, { country: string; currency: string; price: number; at: number }>();
  for (const r of rows) {
    if (r.discount !== undefined && r.discount < 0) continue;
    const l = lows.get(r.country);
    if (!l || l.currency !== r.currency || r.price < l.price) lows.set(r.country, { country: r.country, currency: r.currency, price: r.price, at: r.t });
  }
  return [...lows.values()];
}

/** The lowest of those, in one currency (rounded to cents). */
export function lowestOf(lows: ReturnType<typeof localLows>, currency: string, fx: FxRates | undefined): { price: number; country: string; at: number } | undefined {
  let lowest: { price: number; country: string; at: number } | undefined;
  for (const l of lows) {
    const v = convert(l.price, l.currency, currency, fx);
    if (v !== undefined && (!lowest || v < lowest.price)) lowest = { price: Math.round(v * 100) / 100, country: l.country, at: l.at };
  }
  return lowest;
}
