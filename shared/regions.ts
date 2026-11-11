import type { ShopGroup } from './types';

export interface Region {
  code: string; // ISO 3166 alpha-2
  name: string;
  flag: string;
  currency: string;
  group: Exclude<ShopGroup, 'steam'>;
  /**
   * A short, practical note shown next to the region. These are the
   * questions people ask before buying from a foreign eShop.
   */
  note?: string;
}

/**
 * Nintendo eShop regions we compare. Countries in the same group share game
 * IDs, so one catalog lookup gives prices for every country in the group.
 */
export const SWITCH_REGIONS: Region[] = [
  // Americas
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD', group: 'americas' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD', group: 'americas' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN', group: 'americas' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL', group: 'americas', note: 'Local cards or gift cards usually needed' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', currency: 'ARS', group: 'americas', note: 'Payment is often restricted to local cards' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', currency: 'CLP', group: 'americas' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', currency: 'COP', group: 'americas' },
  { code: 'PE', name: 'Peru', flag: '🇵🇪', currency: 'PEN', group: 'americas' },
  // Europe, Oceania and South Africa share one catalog
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', group: 'europe' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR', group: 'europe' },
  { code: 'FR', name: 'France', flag: '🇫🇷', currency: 'EUR', group: 'europe' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', currency: 'EUR', group: 'europe' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', currency: 'EUR', group: 'europe' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', currency: 'EUR', group: 'europe' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', currency: 'EUR', group: 'europe' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', currency: 'EUR', group: 'europe' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', currency: 'CHF', group: 'europe' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', currency: 'NOK', group: 'europe' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', currency: 'SEK', group: 'europe' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', currency: 'DKK', group: 'europe' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', currency: 'PLN', group: 'europe' },
  { code: 'CZ', name: 'Czechia', flag: '🇨🇿', currency: 'CZK', group: 'europe' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', group: 'europe' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD', group: 'europe' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD', group: 'europe' },
  // Japan, Hong Kong and South Korea each have their own catalog
  { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY', group: 'japan', note: 'Japanese payment methods or gift cards' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', currency: 'HKD', group: 'hongkong' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', currency: 'KRW', group: 'korea' },
  // Southeast Asia shares one set of game IDs (the Philippines opened 2026-11-10)
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP', group: 'sea', note: 'Philippine card and billing address' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD', group: 'sea' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR', group: 'sea' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB', group: 'sea' },
];

/**
 * Regions added after the first release, by the settings version that
 * brought them. A new batch gets a new entry (and the settings version goes up).
 */
export const REGION_ADDITIONS: { version: number; codes: string[] }[] = [
  { version: 5, codes: ['HK', 'KR'] },
  { version: 6, codes: ['PH'] },
  { version: 7, codes: ['SG', 'MY', 'TH'] },
];

/**
 * Bring a saved region list (from settings version `from`) up to date. For
 * each batch added since: if the list had every region that existed before
 * that batch, it was never narrowed, so the batch joins it. A narrowed list
 * was a choice and stays as it is, and so does a region someone unticked
 * after it was added.
 */
export function withNewRegions(saved: string[], from: number): string[] {
  let out = saved;
  for (const step of REGION_ADDITIONS) {
    if (from >= step.version) continue;
    const later = new Set(REGION_ADDITIONS.filter((s) => s.version >= step.version).flatMap((s) => s.codes));
    const existed = SWITCH_REGIONS.map((r) => r.code).filter((c) => !later.has(c));
    if (existed.every((c) => out.includes(c))) out = [...new Set([...out, ...step.codes])];
  }
  return out;
}

/** Steam ties prices to your account country, so this is a comparison view. */
export const STEAM_REGIONS: { code: string; name: string; flag: string; currency: string }[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'DE', name: 'Euro area', flag: '🇪🇺', currency: 'EUR' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', currency: 'KRW' },
  { code: 'CN', name: 'China', flag: '🇨🇳', currency: 'CNY' },
  { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', currency: 'VND' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN' },
  { code: 'AR', name: 'Argentina (LATAM USD)', flag: '🇦🇷', currency: 'USD' },
  { code: 'TR', name: 'Türkiye (MENA USD)', flag: '🇹🇷', currency: 'USD' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', currency: 'PLN' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', currency: 'NOK' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', currency: 'CHF' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR' },
  { code: 'UA', name: 'Ukraine', flag: '🇺🇦', currency: 'UAH' },
  { code: 'KZ', name: 'Kazakhstan', flag: '🇰🇿', currency: 'KZT' },
];

export const HOME_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN',
  'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'ZAR', 'PHP', 'SGD', 'MYR', 'IDR', 'INR', 'KRW', 'HKD', 'THB', 'VND', 'TRY',
];

const byCode = new Map(SWITCH_REGIONS.map((r) => [r.code, r]));
const steamByCode = new Map(STEAM_REGIONS.map((r) => [r.code, r]));

export function switchRegion(code: string): Region | undefined {
  return byCode.get(code);
}

export function regionLabel(code: string): { name: string; flag: string } {
  const r = byCode.get(code) ?? steamByCode.get(code);
  return r ? { name: r.name, flag: r.flag } : { name: code, flag: '🏳️' };
}

/** Default selection: every region. People narrow it in Settings to the shops they can pay in. */
export const DEFAULT_SWITCH_REGIONS = SWITCH_REGIONS.map((r) => r.code);
export const DEFAULT_STEAM_REGIONS = ['US', 'GB', 'DE', 'CA', 'AU', 'JP', 'BR', 'MX', 'AR', 'TR', 'IN', 'PL'];

/** Countries where Steam charges euros although their eShop has its own currency. */
const STEAM_EURO = new Set(['SE', 'DK', 'CZ']);

/** Steam store country to browse deals in. Falls back to US if your home region isn't in the list. */
export function steamStoreCountry(home: string): { code: string; currency: string } {
  const euro = STEAM_EURO.has(home) || SWITCH_REGIONS.some((x) => x.code === home && x.currency === 'EUR');
  const r = steamByCode.get(home) ?? (euro ? steamByCode.get('DE') : undefined);
  return r ? { code: r.code, currency: r.currency } : { code: 'US', currency: 'USD' };
}

/** Rough guess of a sensible starting setup from the device locale. */
export function guessHome(regionCode?: string | null, currencyCode?: string | null) {
  // Countries we don't list (Ireland, Austria, Belgium...) map by currency: euro countries share
  // Nintendo's European store, so Germany is a much better stand-in than the US.
  const byCurrency = currencyCode ? SWITCH_REGIONS.find((r) => r.currency === currencyCode)?.code : undefined;
  const region = regionCode && byCode.has(regionCode) ? regionCode : (byCurrency ?? 'US');
  const currency = currencyCode && HOME_CURRENCIES.includes(currencyCode)
    ? currencyCode
    : byCode.get(region)?.currency ?? 'USD';
  return { region, currency };
}

/**
 * Nintendo's own languages for its eShop web pages. A country left out uses
 * English; Latin America needs Spanish, or the link lands on a store list.
 */
const ESHOP_LANG: Record<string, string> = {
  JP: 'ja', HK: 'zh', KR: 'ko',
  MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es', ES: 'es',
  BR: 'pt', PT: 'pt', FR: 'fr', DE: 'de', AT: 'de', CH: 'de', IT: 'it', NL: 'nl', BE: 'nl',
};

/** Countries whose eShop has no web page per game (the link only reaches a home page). */
const NO_TITLE_PAGE = new Set(['ZA']);

/**
 * A game's page in one country's eShop, from its ID there. Nintendo sends each
 * link on to that country's own store page (checked by hand for every region).
 */
export function eshopTitleUrl(country: string, nsuids: Partial<Record<Region['group'], string>> | undefined): string | undefined {
  const r = byCode.get(country);
  const id = r ? nsuids?.[r.group] : undefined;
  if (!r || !id || NO_TITLE_PAGE.has(country)) return undefined;
  return `https://ec.nintendo.com/${country}/${ESHOP_LANG[country] ?? 'en'}/titles/${id}`;
}
