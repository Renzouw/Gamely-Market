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

function summary(rows: PriceRow[], d: DeviceCtx, platform: Platform, fx?: FxRates, now = Date.now()) {
  const regions = new Set(regionsFor(d, platform));
  // Pass `now` explicitly: a point-free .map(rowToPrice) would hand it the array index
  const mine = rows.filter((r) => regions.has(r.country)).map((r) => rowToPrice(r, now));
  return summarize(mine, { homeCurrency: d.currency, homeRegion: platform === 'steam' ? steamStoreCountry(d.homeRegion).code : d.homeRegion, fx });
}

function best(rows: PriceRow[], d: DeviceCtx, platform: Platform, fx?: FxRates, now = Date.now()) {
  return summary(rows, d, platform, fx, now).best;
}

const where = (country: string) => {
  const r = regionLabel(country);
  return `${r.flag} ${r.name}`;
};

/**
 * What to tell one person about one watched game after a price refresh,
 * most important first. The caller sends the first one that isn't a
 * duplicate, so a single price change never produces a pile of alerts,
 * and a repeat of an old alert doesn't hide a new, different one.
 */
export function planAlertCandidates(input: {
  device: DeviceCtx;
  watch: WatchCtx;
  before: PriceRow[];
  after: PriceRow[];
  newLowCountries: string[];
  fx?: FxRates;
  now?: number;
}): PlannedAlert[] {
  const { device: d, watch: w, fx } = input;
  const now = input.now ?? Date.now();
  const beforeSummary = summary(input.before, d, w.platform, fx, now);
  const afterSummary = summary(input.after, d, w.platform, fx, now);
  const b = beforeSummary.best;
  const a = afterSummary.best;
  if (!a || a.converted === undefined) return [];

  const price = formatMoney(a.converted, d.currency);
  const local = a.current.currency !== d.currency ? ` (${formatMoney(a.current.amount, a.current.currency)})` : '';
  const ends = a.saleEndsAt ? Date.parse(a.saleEndsAt) : undefined;
  const left = timeLeft(a.saleEndsAt, now);
  const endsText = left ? ` Ends in ${left}.` : '';
  const k = `${d.id}:${w.gameId}`;
  const day = new Date(now).toISOString().slice(0, 10);
  // Identifies this particular sale, so the same alert can fire again for a later sale
  const saleTag = a.saleEndsAt ?? day;

  // Sales that have already ended don't count, even before the next refresh confirms it
  const hadSale = beforeSummary.ranked.some((p) => p.sale);
  const hasSale = afterSummary.ranked.some((p) => p.sale);
  const lowHere = input.newLowCountries.includes(a.country);
  const out: PlannedAlert[] = [];

  if (w.alerts.target && w.target !== undefined && a.converted <= w.target + 0.005 && (b?.converted === undefined || b.converted > w.target + 0.005)) {
    out.push({
      kind: 'target',
      title: `${w.title} hit your price`,
      body: `${price}${local} in ${where(a.country)}. Your target was ${formatMoney(w.target, d.currency)}.${endsText}`,
      dedupeKey: `target:${k}:${w.target}:${a.converted.toFixed(2)}:${saleTag}`,
      expiresAt: ends,
    });
  }
  if (w.alerts.low && lowHere && a.sale) {
    out.push({
      kind: 'low',
      title: `${w.title}: lowest price yet`,
      body: `${price}${local} in ${where(a.country)}, the lowest we’ve recorded there.${endsText}`,
      dedupeKey: `low:${k}:${a.country}:${a.current.amount}`,
      expiresAt: ends,
    });
  }
  if (w.alerts.sale && hasSale && !hadSale && a.sale) {
    out.push({
      kind: 'sale',
      title: `${w.title} is on sale`,
      body: `${a.discountPercent}% off: ${price}${local} in ${where(a.country)}.${endsText}`,
      dedupeKey: `sale:${k}:${saleTag}`,
      expiresAt: ends,
    });
  }
  // Your own eShop started a sale, even though another region is still cheaper.
  // Most people would rather buy at home, so this is worth a heads-up too.
  const home = afterSummary.home;
  const homeBefore = beforeSummary.ranked.find((p) => p.country === home?.country);
  if (w.alerts.sale && home?.sale && !homeBefore?.sale && home.converted !== undefined && home.country !== a.country) {
    const homeLocal = home.current.currency !== d.currency ? ` (${formatMoney(home.current.amount, home.current.currency)})` : '';
    const homeLeft = timeLeft(home.saleEndsAt, now);
    out.push({
      kind: 'sale',
      title: `${w.title} is on sale in your eShop`,
      body: `${home.discountPercent}% off: ${formatMoney(home.converted, d.currency)}${homeLocal}. Still cheaper in ${where(a.country)} at ${price}.${homeLeft ? ` Ends in ${homeLeft}.` : ''}`,
      dedupeKey: `sale:${k}:home:${home.saleEndsAt ?? day}`,
      expiresAt: home.saleEndsAt ? Date.parse(home.saleEndsAt) : undefined,
    });
  }
  // A country priced for the first time didn't drop: it just wasn't being compared before
  const pricedBefore = input.before.some((r) => r.country === a.country);
  if (w.alerts.drop && pricedBefore && b?.converted !== undefined && a.converted < b.converted * 0.99) {
    out.push({
      kind: 'drop',
      title: `${w.title} dropped to ${price}`,
      body: `Down from ${formatMoney(b.converted, d.currency)}. Cheapest in ${where(a.country)}${local}.${endsText}`,
      dedupeKey: `drop:${k}:${a.converted.toFixed(2)}:${saleTag}`,
      expiresAt: ends,
    });
  }
  return out;
}

/** The single most important alert, if any. */
export function planAlerts(input: Parameters<typeof planAlertCandidates>[0]): PlannedAlert | undefined {
  return planAlertCandidates(input)[0];
}

/** A sale you're watching ends within 24 hours. One reminder per sale. */
export function planEnding(input: { device: DeviceCtx; watch: WatchCtx; rows: PriceRow[]; fx?: FxRates; now?: number }): PlannedAlert | undefined {
  const { device: d, watch: w } = input;
  if (!w.alerts.ending) return undefined;
  const now = input.now ?? Date.now();
  const a = best(input.rows, d, w.platform, input.fx, now);
  if (!a?.sale || !a.saleEndsAt || a.converted === undefined) return undefined;
  const ends = Date.parse(a.saleEndsAt);
  if (!(ends > now && ends - now <= 24 * 3600_000)) return undefined;
  return {
    kind: 'ending',
    title: `Last chance: ${w.title}`,
    body: `${a.discountPercent}% off ends in ${timeLeft(a.saleEndsAt, now)}. ${formatMoney(a.converted, d.currency)} in ${where(a.country)}.`,
    dedupeKey: `ending:${d.id}:${w.gameId}:${a.saleEndsAt}`,
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
