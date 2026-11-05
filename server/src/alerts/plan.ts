import type { AlertKind, AlertPrefs } from '@shared/api';
import { formatMoney, summarize, timeLeft } from '@shared/pricing';
import { regionLabel, steamStoreCountry } from '@shared/regions';
import type { FxRates, Platform } from '@shared/types';
import { rowToPrice, type PriceRow } from '../store';

export interface DeviceCtx {
  id: string;
  currency: string;
  homeRegion: string;
  switchRegions: string[];
  steamRegions: string[];
}

export interface WatchCtx {
  gameId: string;
  title: string;
  platform: Platform;
  target?: number;
  alerts: AlertPrefs;
}

export interface PlannedAlert {
  kind: AlertKind;
  title: string;
  body: string;
  dedupeKey: string;
  /** Don't deliver after this (e.g. the sale already ended) */
  expiresAt?: number;
}

/**
 * The regions that count for this person. For Steam that's only the store
 * country their account buys in: an alert for a price they can't pay
 * would be noise.
 */
export function regionsFor(d: DeviceCtx, platform: Platform): string[] {
  if (platform === 'steam') return [steamStoreCountry(d.homeRegion).code];
  return d.switchRegions.includes(d.homeRegion) ? d.switchRegions : [...d.switchRegions, d.homeRegion];
}

function best(rows: PriceRow[], d: DeviceCtx, platform: Platform, fx?: FxRates) {
  const regions = new Set(regionsFor(d, platform));
  const mine = rows.filter((r) => regions.has(r.country)).map(rowToPrice);
  return summarize(mine, { homeCurrency: d.currency, homeRegion: platform === 'steam' ? steamStoreCountry(d.homeRegion).code : d.homeRegion, fx }).best;
}

const where = (country: string) => {
  const r = regionLabel(country);
  return `${r.flag} ${r.name}`;
};

/**
 * What to tell one person about one watched game after a price refresh.
 * Returns at most one alert, the most important one, so a single price
 * change never produces a pile of notifications.
 */
export function planAlerts(input: {
  device: DeviceCtx;
  watch: WatchCtx;
  before: PriceRow[];
  after: PriceRow[];
  newLowCountries: string[];
  fx?: FxRates;
}): PlannedAlert | undefined {
  const { device: d, watch: w, fx } = input;
  const regions = new Set(regionsFor(d, w.platform));
  const b = best(input.before, d, w.platform, fx);
  const a = best(input.after, d, w.platform, fx);
  if (!a || a.converted === undefined) return undefined;

  const price = formatMoney(a.converted, d.currency);
  const local = a.current.currency !== d.currency ? ` (${formatMoney(a.current.amount, a.current.currency)})` : '';
  const ends = a.saleEndsAt ? Date.parse(a.saleEndsAt) : undefined;
  const left = timeLeft(a.saleEndsAt);
  const endsText = left ? ` Ends in ${left}.` : '';
  const k = `${d.id}:${w.gameId}`;
  const priceKey = a.converted.toFixed(2);

  const hadSale = input.before.some((r) => regions.has(r.country) && r.sale !== null);
  const hasSale = input.after.some((r) => regions.has(r.country) && r.sale !== null);
  const lowHere = input.newLowCountries.find((c) => c === a.country);

  if (w.alerts.target && w.target !== undefined && a.converted <= w.target + 0.005 && (b?.converted === undefined || b.converted > w.target + 0.005)) {
    return {
      kind: 'target',
      title: `${w.title} hit your price`,
      body: `${price}${local} in ${where(a.country)}. Your target was ${formatMoney(w.target, d.currency)}.${endsText}`,
      dedupeKey: `target:${k}:${w.target}:${priceKey}`,
      expiresAt: ends,
    };
  }
  if (w.alerts.low && lowHere && a.sale) {
    return {
      kind: 'low',
      title: `${w.title}: lowest price yet`,
      body: `${price}${local} in ${where(a.country)}, the lowest we've recorded there.${endsText}`,
      dedupeKey: `low:${k}:${a.country}:${a.current.amount}`,
      expiresAt: ends,
    };
  }
  if (w.alerts.sale && hasSale && !hadSale && a.sale) {
    return {
      kind: 'sale',
      title: `${w.title} is on sale`,
      body: `${a.discountPercent}% off: ${price}${local} in ${where(a.country)}.${endsText}`,
      dedupeKey: `sale:${k}:${a.saleEndsAt ?? new Date().toISOString().slice(0, 10)}`,
      expiresAt: ends,
    };
  }
  if (w.alerts.drop && b?.converted !== undefined && a.converted < b.converted * 0.99) {
    return {
      kind: 'drop',
      title: `${w.title} dropped to ${price}`,
      body: `Down from ${formatMoney(b.converted, d.currency)}. Cheapest in ${where(a.country)}${local}.${endsText}`,
      dedupeKey: `drop:${k}:${priceKey}`,
      expiresAt: ends,
    };
  }
  return undefined;
}

/** A sale you're watching ends within 24 hours. One reminder per sale. */
export function planEnding(input: { device: DeviceCtx; watch: WatchCtx; rows: PriceRow[]; fx?: FxRates; now?: number }): PlannedAlert | undefined {
  const { device: d, watch: w } = input;
  if (!w.alerts.ending) return undefined;
  const now = input.now ?? Date.now();
  const a = best(input.rows, d, w.platform, input.fx);
  if (!a?.sale || !a.saleEndsAt || a.converted === undefined) return undefined;
  const ends = Date.parse(a.saleEndsAt);
  if (!(ends > now && ends - now <= 24 * 3600_000)) return undefined;
  return {
    kind: 'ending',
    title: `Last chance: ${w.title}`,
    body: `${a.discountPercent}% off ends in ${timeLeft(a.saleEndsAt, now)}. ${formatMoney(a.converted, d.currency)} in ${where(a.country)}.`,
    dedupeKey: `ending:${d.id}:${w.gameId}:${a.country}:${a.saleEndsAt}`,
    expiresAt: ends,
  };
}

/**
 * When can we deliver? Quiet hours are in the person's own time zone, and
 * an alert that lands inside them waits until they end.
 */
export function nextSendTime(now: number, tz: string, quietStart?: number | null, quietEnd?: number | null): number {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return now;
  let hour: number;
  let minute: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
    hour = Number(parts.find((p) => p.type === 'hour')?.value);
    minute = Number(parts.find((p) => p.type === 'minute')?.value);
  } catch {
    return now;
  }
  const inQuiet = quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
  if (!inQuiet) return now;
  const hoursUntilEnd = (quietEnd - hour + 24) % 24 || 24;
  return now + (hoursUntilEnd * 60 - minute) * 60_000;
}
