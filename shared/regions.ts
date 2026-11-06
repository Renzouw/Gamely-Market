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
];

/** Regions added after the first release. */
export const NEW_SWITCH_REGIONS = ['HK', 'KR'];

/**
 * A saved region list from before the new regions existed. If it had every
 * older region ticked, it was never narrowed, so the new ones join it. A
 * narrowed list was a choice and stays as it is.
 */
export function withNewRegions(saved: string[]): string[] {
  const older = SWITCH_REGIONS.map((r) => r.code).filter((c) => !NEW_SWITCH_REGIONS.includes(c));
  return older.every((c) => saved.includes(c)) ? [...new Set([...saved, ...NEW_SWITCH_REGIONS])] : saved;
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

/** Steam store country to browse deals in. Falls back to US if your home region isn't in the list. */
export function steamStoreCountry(home: string): { code: string; currency: string } {
  const r = steamByCode.get(home) ?? (SWITCH_REGIONS.some((x) => x.code === home && x.currency === 'EUR') ? steamByCode.get('DE') : undefined);
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
