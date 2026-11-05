import type { EventPrefs } from '@shared/api';
import { formatMoney, summarize } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import type { FxRates, Platform } from '@shared/types';
import { regionsFor, type DeviceCtx } from '../alerts/plan';
import { rowToPrice, type PriceRow } from '../store';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface EventRules {
  /** Current count must be at least this multiple of a normal day */
  startRatio: number;
  /** And at least this many more games than normal, so small catalogs don't trip it */
  minJump: Record<Platform, number>;
  /** The event is over once the count falls back under this multiple */
  endRatio: number;
  /** Readings needed in the baseline window before we trust it */
  minReadings: number;
}

export const DEFAULT_RULES: EventRules = {
  startRatio: 1.6,
  minJump: { steam: 1500, switch: 300, switch2: 40 },
  endRatio: 1.25,
  minReadings: 24,
};

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * A "normal day" is the median count from 2 to 8 days ago. The last two
 * days are left out so a sale that is just starting doesn't count as normal.
 */
export function baselineFrom(history: { t: number; count: number }[], now: number, rules = DEFAULT_RULES): number | undefined {
  const window = history.filter((h) => h.t >= now - 8 * DAY && h.t < now - 2 * DAY).map((h) => h.count);
  return window.length >= rules.minReadings ? median(window) : undefined;
}

export type EventDecision = { action: 'start'; baseline: number } | { action: 'update' } | { action: 'end' } | { action: 'none' };

export function evaluate(input: {
  platform: Platform;
  current: number;
  history: { t: number; count: number }[];
  active?: { baseline: number };
  now: number;
  rules?: EventRules;
}): EventDecision {
  const rules = input.rules ?? DEFAULT_RULES;
  if (input.active) {
    return input.current < input.active.baseline * rules.endRatio ? { action: 'end' } : { action: 'update' };
  }
  const baseline = baselineFrom(input.history, input.now, rules);
  if (baseline === undefined || baseline <= 0) return { action: 'none' };
  const big = input.current >= baseline * rules.startRatio && input.current - baseline >= rules.minJump[input.platform];
  return big ? { action: 'start', baseline: Math.round(baseline) } : { action: 'none' };
}

/* ------------------------------ big deals ------------------------------ */

export interface DealCandidate {
  gameId: string;
  title: string;
  platform: Platform;
  rank: number;
  prices: PriceRow[];
}

export interface PickedDeal {
  gameId: string;
  title: string;
  platform: Platform;
  discount: number;
  price: number;
  country: string;
  local?: string;
  saleKey: string;
}

/**
 * Popular games at a deep discount in this person's own regions and
 * currency, most popular first. Games they already watch, or have already
 * been told about for this sale, are skipped.
 */
export function pickBigDeals(input: {
  device: DeviceCtx;
  prefs: EventPrefs;
  candidates: DealCandidate[];
  watched: Set<string>;
  seen: Set<string>;
  fx?: FxRates;
  now?: number;
}): PickedDeal[] {
  const { device: d, prefs } = input;
  const now = input.now ?? Date.now();
  const out: PickedDeal[] = [];
  for (const c of [...input.candidates].sort((a, b) => a.rank - b.rank)) {
    if (!prefs.platforms.includes(c.platform) || input.watched.has(c.gameId)) continue;
    const regions = new Set(regionsFor(d, c.platform));
    const mine = c.prices.filter((p) => regions.has(p.country)).map((p) => rowToPrice(p, now));
    const best = summarize(mine, { homeCurrency: d.currency, homeRegion: d.homeRegion, fx: input.fx }).best;
    if (!best?.sale || best.converted === undefined || best.discountPercent < prefs.minDiscount) continue;
    const saleKey = best.saleEndsAt ?? new Date(now).toISOString().slice(0, 10);
    if (input.seen.has(`${c.gameId}|${saleKey}`)) continue;
    out.push({
      gameId: c.gameId,
      title: c.title,
      platform: c.platform,
      discount: best.discountPercent,
      price: best.converted,
      country: best.country,
      local: best.current.currency !== d.currency ? formatMoney(best.current.amount, best.current.currency) : undefined,
      saleKey,
    });
  }
  return out;
}

const STORE_NAME: Record<Platform, string> = { steam: 'Steam', switch: 'Nintendo eShop', switch2: 'Nintendo eShop' };

export function composeDeals(deals: PickedDeal[], currency: string): { title: string; body: string; data: Record<string, unknown> } {
  if (deals.length === 1) {
    const d = deals[0];
    const where = d.platform === 'steam' ? '' : ` in ${regionLabel(d.country).flag} ${regionLabel(d.country).name}`;
    return {
      title: `${d.title} is ${d.discount}% off`,
      body: `${formatMoney(d.price, currency)}${d.local ? ` (${d.local})` : ''}${where}. One of the most popular games on ${STORE_NAME[d.platform]} right now.`,
      data: { gameId: d.gameId, kind: 'deals' },
    };
  }
  const top = deals.slice(0, 3).map((d) => `${d.title} −${d.discount}% (${formatMoney(d.price, currency)})`);
  const more = deals.length - top.length;
  return {
    title: `${deals.length} big deals on popular games`,
    body: `${top.join(', ')}${more ? ` and ${more} more` : ''}.`,
    data: { screen: 'deals', platform: deals[0].platform, kind: 'deals' },
  };
}

export function composeEvent(
  started: { platform: Platform; count: number; baseline: number }[],
  topPicks: PickedDeal[],
): { title: string; body: string; data: Record<string, unknown> } {
  const steam = started.find((e) => e.platform === 'steam');
  const nintendo = started.filter((e) => e.platform !== 'steam');
  const describe = (count: number, baseline: number) => {
    const ratio = count / baseline;
    return `${count.toLocaleString('en-US')} games discounted, ${ratio >= 2 ? `about ${Math.round(ratio)}× a normal day` : `up from about ${baseline.toLocaleString('en-US')}`}`;
  };
  const picks = topPicks.length ? ` Top picks: ${topPicks.slice(0, 2).map((p) => `${p.title} −${p.discount}%`).join(', ')}.` : '';
  if (steam && nintendo.length) {
    return {
      title: 'Big sales on Steam and the eShop',
      body: `Steam: ${describe(steam.count, steam.baseline)}. eShop: ${describe(nintendo.reduce((a, e) => a + e.count, 0), nintendo.reduce((a, e) => a + e.baseline, 0))}.${picks}`,
      data: { screen: 'deals', platform: 'steam', kind: 'event' },
    };
  }
  if (steam) return { title: 'A big Steam sale is on', body: `${describe(steam.count, steam.baseline)}.${picks}`, data: { screen: 'deals', platform: 'steam', kind: 'event' } };
  const count = nintendo.reduce((a, e) => a + e.count, 0);
  const baseline = nintendo.reduce((a, e) => a + e.baseline, 0);
  const platform = nintendo.some((e) => e.platform === 'switch2') ? 'switch2' : 'switch';
  return { title: 'A big eShop sale is on', body: `${describe(count, baseline)}.${picks}`, data: { screen: 'deals', platform, kind: 'event' } };
}
