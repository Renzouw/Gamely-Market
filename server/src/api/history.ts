import type { HistoryPoint } from '@shared/api';
import { convert } from '@shared/pricing';
import type { FxRates } from '@shared/types';

export interface HistoryRow {
  country: string;
  t: number;
  currency: string;
  price: number;
}

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
  while (i < sorted.length && sorted[i].t < from) {
    const r = sorted[i++];
    const v = convert(r.price, r.currency, currency, fx);
    if (v !== undefined) current.set(r.country, v);
  }

  for (let day = from; day <= dayStart(now); day += DAY) {
    let dayBest = bestNow();
    while (i < sorted.length && sorted[i].t < day + DAY) {
      const r = sorted[i++];
      const v = convert(r.price, r.currency, currency, fx);
      if (v === undefined) continue;
      current.set(r.country, v);
      const b = bestNow();
      if (b && (!dayBest || b.v < dayBest.v)) dayBest = b;
    }
    if (dayBest) out.push({ t: day, best: Math.round(dayBest.v * 100) / 100, country: dayBest.c });
  }
  return out;
}
