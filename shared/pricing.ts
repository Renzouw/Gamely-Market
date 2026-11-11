import type { ConvertedRegionPrice, FxRates, Money, RegionPrice } from './types';

export function convert(amount: number, from: string, to: string, fx?: FxRates): number | undefined {
  if (from === to) return amount;
  if (!fx) return undefined;
  const rFrom = from === fx.base ? 1 : fx.rates[from];
  const rTo = to === fx.base ? 1 : fx.rates[to];
  if (!rFrom || !rTo) return undefined;
  return (amount / rFrom) * rTo;
}

export function currentPrice(p: RegionPrice): Money {
  return p.sale ?? p.regular;
}

export function withConversion(prices: RegionPrice[], home: string, fx?: FxRates): ConvertedRegionPrice[] {
  return prices.map((p) => {
    const current = currentPrice(p);
    return {
      ...p,
      current,
      converted: convert(current.amount, current.currency, home, fx),
      convertedRegular: convert(p.regular.amount, p.regular.currency, home, fx),
    };
  });
}

/** Cheapest first. Prices we can't convert sink to the bottom. Free games (0) count as cheapest. */
export function rankByPrice(prices: ConvertedRegionPrice[]): ConvertedRegionPrice[] {
  return [...prices].sort((a, b) => {
    if (a.converted === undefined && b.converted === undefined) return a.country.localeCompare(b.country);
    if (a.converted === undefined) return 1;
    if (b.converted === undefined) return -1;
    return a.converted - b.converted;
  });
}

export interface PriceSummary {
  best?: ConvertedRegionPrice;
  home?: ConvertedRegionPrice;
  /** How much cheaper the best region is than home, as a fraction (0.35 = 35% less) */
  savingVsHome?: number;
  onSaleCount: number;
  ranked: ConvertedRegionPrice[];
}

export function summarize(
  prices: RegionPrice[],
  opts: { homeCurrency: string; homeRegion: string; fx?: FxRates },
): PriceSummary {
  const ranked = rankByPrice(withConversion(prices, opts.homeCurrency, opts.fx));
  const home = ranked.find((p) => p.country === opts.homeRegion);
  // A tie goes to home (euro eShops often charge the same): no point sending someone abroad for nothing
  const cheapest = ranked.find((p) => p.converted !== undefined);
  const best = cheapest && home?.converted !== undefined && cheapest.converted !== undefined && home.converted - cheapest.converted < 0.005 ? home : cheapest;
  let savingVsHome: number | undefined;
  if (best && home?.converted && best.converted !== undefined && home.converted > 0) {
    savingVsHome = Math.max(0, 1 - best.converted / home.converted);
  }
  return {
    best,
    home,
    savingVsHome,
    onSaleCount: prices.filter((p) => p.sale).length,
    ranked,
  };
}

export function discountPercent(regular: number, sale?: number): number {
  if (sale === undefined || regular <= 0 || sale >= regular) return 0;
  // Any real discount shows as at least 1%, never "0% off"
  return Math.max(1, Math.round((1 - sale / regular) * 100));
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'COP', 'VND', 'IDR', 'HUF', 'ISK', 'TWD']);

/** Decimal places a currency's prices are shown with: 0 for yen, won and the like, else 2. */
export function currencyDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export function formatMoney(amount: number | undefined, currency: string, locale?: string): string {
  if (amount === undefined || Number.isNaN(amount)) return '–';
  if (amount === 0) return 'Free';
  const digits = currencyDigits(currency);
  const f = formatter(currency, digits, locale);
  return f ? f.format(amount) : `${currency} ${amount.toFixed(digits)}`;
}

/** A whole amount, like a gift card's face value: "$50", not "$50.00". */
export function formatWhole(amount: number, currency: string, locale?: string): string {
  const f = formatter(currency, 0, locale);
  return f ? f.format(amount) : `${currency} ${Math.round(amount)}`;
}

/** Building an Intl.NumberFormat is slow; lists format hundreds of prices, so reuse them. */
const formatters = new Map<string, Intl.NumberFormat | null>();
function formatter(currency: string, digits: number, locale?: string): Intl.NumberFormat | null {
  const key = `${locale ?? ''}|${currency}|${digits}`;
  let f = formatters.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = null; // unknown currency code
    }
    formatters.set(key, f);
  }
  return f;
}

/** "2d 4h", "5h", "40m", or undefined when the date is missing/past. */
export function timeLeft(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const end = Date.parse(iso);
  if (Number.isNaN(end) || end <= now) return undefined;
  const mins = Math.floor((end - now) / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, mins)}m`;
}

/** Ending in under 48h. Used for the "ending soon" badge. */
export function endsSoon(iso: string | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const end = Date.parse(iso);
  return !Number.isNaN(end) && end > now && end - now < 48 * 3600 * 1000;
}
