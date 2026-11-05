import { chunk, getJson, qs } from '../http';
import { discountPercent } from '../../domain/pricing';
import type { RegionPrice } from '../../domain/types';

/**
 * Nintendo's eShop price endpoint. Accepts up to 50 NSUIDs per call, one
 * country at a time, and returns the live regular and sale price.
 */
const PRICE_URL = 'https://api.ec.nintendo.com/v1/price';
const BATCH = 50;

interface RawAmount {
  amount?: string;
  currency?: string;
  raw_value?: string;
  start_datetime?: string;
  end_datetime?: string;
}

export interface RawPriceResponse {
  country?: string;
  prices?: {
    title_id: number | string;
    sales_status?: string;
    regular_price?: RawAmount;
    discount_price?: RawAmount;
  }[];
}

export function parsePriceResponse(country: string, data: RawPriceResponse): Map<string, RegionPrice> {
  const out = new Map<string, RegionPrice>();
  for (const p of data.prices ?? []) {
    if (p.sales_status && p.sales_status !== 'onsale') continue;
    const reg = p.regular_price;
    if (!reg?.raw_value || !reg.currency) continue;
    const regular = { amount: Number(reg.raw_value), currency: reg.currency };
    if (!Number.isFinite(regular.amount)) continue;

    const disc = p.discount_price;
    const saleAmount = disc?.raw_value !== undefined ? Number(disc.raw_value) : undefined;
    const hasSale = saleAmount !== undefined && Number.isFinite(saleAmount) && saleAmount < regular.amount;
    out.set(String(p.title_id), {
      country,
      regular,
      sale: hasSale ? { amount: saleAmount!, currency: disc!.currency ?? regular.currency } : undefined,
      discountPercent: hasSale ? discountPercent(regular.amount, saleAmount) : 0,
      saleEndsAt: hasSale ? disc!.end_datetime : undefined,
    });
  }
  return out;
}

export async function fetchCountryPrices(country: string, nsuids: string[]): Promise<Map<string, RegionPrice>> {
  const unique = [...new Set(nsuids.filter(Boolean))];
  const merged = new Map<string, RegionPrice>();
  const lang = country === 'JP' ? 'ja' : 'en';
  const batches = await Promise.all(
    chunk(unique, BATCH).map((ids) =>
      getJson<RawPriceResponse>(`${PRICE_URL}?${qs({ country, lang, ids: ids.join(',') })}`)
        .then((data) => parsePriceResponse(country, data))
        // One country failing (closed shop, outage) shouldn't sink the rest.
        .catch(() => new Map<string, RegionPrice>()),
    ),
  );
  for (const b of batches) b.forEach((v, k) => merged.set(k, v));
  return merged;
}

/**
 * Prices for many NSUIDs across many countries.
 * Returns nsuid -> list of RegionPrice (one per country where it's sold).
 */
export async function fetchPricesByCountry(
  requests: { country: string; nsuids: string[] }[],
): Promise<Map<string, RegionPrice[]>> {
  const results = await Promise.all(requests.map((r) => fetchCountryPrices(r.country, r.nsuids)));
  const byNsuid = new Map<string, RegionPrice[]>();
  results.forEach((map) =>
    map.forEach((price, nsuid) => {
      const list = byNsuid.get(nsuid) ?? [];
      list.push(price);
      byNsuid.set(nsuid, list);
    }),
  );
  return byNsuid;
}
