import type { PriceSummary } from '@shared/pricing';
import { formatMoney, timeLeft } from '@shared/pricing';
import { regionLabel } from '@shared/regions';
import type { LocalWatch } from '../state/watchlist';

export interface LocalAlert {
  kind: 'target' | 'low' | 'sale' | 'drop' | 'ending';
  key: string;
  title: string;
  body: string;
}

const where = (c: string) => `${regionLabel(c).flag} ${regionLabel(c).name}`;

/**
 * The phone's own version of the server's alert rules, for when the server
 * isn't around. Compares this check with the last one; at most one alert,
 * most important first. Pure, so it's easy to test.
 */
export function planLocalAlert(w: LocalWatch, s: PriceSummary, currency: string, lowestBefore: number | undefined, now = Date.now()): LocalAlert | undefined {
  const a = s.best;
  if (!a || a.converted === undefined) return undefined;
  const prev = w.last;
  const price = formatMoney(a.converted, currency);
  const saleTag = a.saleEndsAt ?? new Date(now).toISOString().slice(0, 10);
  const left = timeLeft(a.saleEndsAt, now);
  const endsText = left ? ` Ends in ${left}.` : '';
  const title = w.game.title;
  const out: LocalAlert[] = [];

  if (w.alerts.target && w.target !== undefined && a.converted <= w.target + 0.005 && (prev?.best === undefined || prev.best > w.target + 0.005)) {
    out.push({ kind: 'target', key: `target:${w.target}:${saleTag}`, title: `${title} hit your price`, body: `${price} in ${where(a.country)}. Your target was ${formatMoney(w.target, currency)}.${endsText}` });
  }
  if (w.alerts.low && a.sale && lowestBefore !== undefined && a.converted < lowestBefore - 0.01) {
    out.push({ kind: 'low', key: `low:${a.country}:${a.converted.toFixed(2)}`, title: `${title}: lowest price yet`, body: `${price} in ${where(a.country)}, the lowest this phone has seen.${endsText}` });
  }
  // "Went on sale" needs a previous check to compare with
  if (w.alerts.sale && a.sale && prev && prev.onSale === false) {
    out.push({ kind: 'sale', key: `sale:${saleTag}`, title: `${title} is on sale`, body: `${a.discountPercent}% off: ${price} in ${where(a.country)}.${endsText}` });
  }
  if (w.alerts.sale && s.home?.sale && s.home.country !== a.country && prev && prev.homeOnSale === false && s.home.converted !== undefined) {
    out.push({
      kind: 'sale',
      key: `sale:home:${s.home.saleEndsAt ?? saleTag}`,
      title: `${title} is on sale in your eShop`,
      body: `${s.home.discountPercent}% off: ${formatMoney(s.home.converted, currency)}. Still cheaper in ${where(a.country)} at ${price}.`,
    });
  }
  if (w.alerts.drop && prev?.best !== undefined && a.converted < prev.best * 0.99) {
    out.push({ kind: 'drop', key: `drop:${a.converted.toFixed(2)}:${saleTag}`, title: `${title} dropped to ${price}`, body: `Down from ${formatMoney(prev.best, currency)}. Cheapest in ${where(a.country)}.${endsText}` });
  }
  if (w.alerts.ending && a.sale && a.saleEndsAt) {
    const ends = Date.parse(a.saleEndsAt);
    if (ends > now && ends - now <= 24 * 3600_000) {
      out.push({ kind: 'ending', key: `ending:${a.saleEndsAt}`, title: `Last chance: ${title}`, body: `${a.discountPercent}% off ends in ${left}. ${price} in ${where(a.country)}.` });
    }
  }
  return out.find((x) => !w.sent.includes(x.key));
}
