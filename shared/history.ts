import type { HistoryPoint } from './api';
import { convert } from './pricing';
import type { FxRates } from './types';

export interface HistoryRow {
  country: string;
  t: number;
  currency: string;
  price: number;
  /** -1 marks the game being delisted in that country */
  discount?: number;
}

const apply = (current: Map<string, number>, r: HistoryRow, currency: string, fx?: FxRates) => {
  if (r.discount !== undefined && r.discount < 0) {
    current.delete(r.country);
    return;
  }
  const v = convert(r.price, r.currency, currency, fx);
  if (v !== undefined) current.set(r.country, v);
};

const DAY = 86400_000;
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;

/**
 * Daily best price across the caller's regions, converted at today's rates
 * so the line moves only when a store price moves, not with currency swings.
 * Each day records the lowest price available at any point that day.
 */
export function dailyBest(rows: HistoryRow[], currency: string, fx: FxRates | undefined, now = Date.now(), maxDays = 365): HistoryPoint[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const from = Math.max(dayStart(sorted[0].t), dayStart(now) - (maxDays - 1) * DAY);
  const current = new Map<string, number>();
  const out: HistoryPoint[] = [];
  let i = 0;

  const bestNow = () => {
    let best: { v: number; c: string } | undefined;
    current.forEach((v, c) => {
      if (!best || v < best.v) best = { v, c };
    });
    return best;
  };

  // Replay everything before the window so the first day starts correct
  while (i < sorted.length && sorted[i].t < from) apply(current, sorted[i++], currency, fx);

  for (let day = from; day <= dayStart(now); day += DAY) {
    let dayBest = bestNow();
    while (i < sorted.length && sorted[i].t < day + DAY) {
      apply(current, sorted[i++], currency, fx);
      const b = bestNow();
      if (b && (!dayBest || b.v < dayBest.v)) dayBest = b;
    }
    if (dayBest) out.push({ t: day, best: Math.round(dayBest.v * 100) / 100, country: dayBest.c });
  }
  return out;
}
