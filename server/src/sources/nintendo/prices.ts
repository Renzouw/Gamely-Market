import { config } from '../../config';
import { chunk, getJson, qs } from '../http';
import { discountPercent } from '@shared/pricing';
import type { RegionPrice } from '@shared/types';

/**
 * Nintendo's eShop price endpoint: the same prices the eShop charges at
 * checkout. Up to 50 NSUIDs per call, one country at a time.
 */
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

export interface CountryPrices {
  prices: Map<string, RegionPrice>;
  /** IDs the store says are no longer sold here. Their stored price should go. */
  gone: Set<string>;
}

const GONE = new Set(['not_found', 'sales_termination', 'unreleased']);

export function parsePriceResponse(country: string, data: RawPriceResponse, now = Date.now()): CountryPrices {
  const prices = new Map<string, RegionPrice>();
  const gone = new Set<string>();
  for (const p of data.prices ?? []) {
    const id = String(p.title_id);
    if (p.sales_status && p.sales_status !== 'onsale') {
      if (GONE.has(p.sales_status)) gone.add(id);
      continue;
    }
    const reg = p.regular_price;
    const regularAmount = Number(reg?.raw_value);
    if (!reg?.currency || !Number.isFinite(regularAmount)) continue;

    const disc = p.discount_price;
    const saleAmount = disc?.raw_value !== undefined ? Number(disc.raw_value) : undefined;
    const start = disc?.start_datetime ? Date.parse(disc.start_datetime) : undefined;
    const end = disc?.end_datetime ? Date.parse(disc.end_datetime) : undefined;
    // Only count a discount that is live right now
    const live = (start === undefined || start <= now) && (end === undefined || end > now);
    const hasSale = live && saleAmount !== undefined && Number.isFinite(saleAmount) && saleAmount < regularAmount;

    prices.set(id, {
      country,
      regular: { amount: regularAmount, currency: reg.currency },
      sale: hasSale ? { amount: saleAmount!, currency: disc!.currency ?? reg.currency } : undefined,
      discountPercent: hasSale ? discountPercent(regularAmount, saleAmount) : 0,
      saleEndsAt: hasSale ? disc!.end_datetime : undefined,
    });
  }
  return { prices, gone };
}

/** Throws if any batch fails, so callers never mistake an outage for "not sold". */
export async function fetchCountryPrices(country: string, nsuids: string[]): Promise<CountryPrices> {
  const lang = country === 'JP' ? 'ja' : 'en';
  const out: CountryPrices = { prices: new Map(), gone: new Set() };
  for (const ids of chunk([...new Set(nsuids.filter(Boolean))], BATCH)) {
    const data = await getJson<RawPriceResponse>(`${config.upstream.nintendoPrice}?${qs({ country, lang, ids: ids.join(',') })}`);
    const part = parsePriceResponse(country, data);
    part.prices.forEach((v, k) => out.prices.set(k, v));
    part.gone.forEach((k) => out.gone.add(k));
  }
  return out;
}
