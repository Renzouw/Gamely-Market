import { config } from '../../config';
import { chunk, getJson, qs } from '../http';
import { parsePriceResponse, PRICE_BATCH, priceQuery, type CountryPrices, type RawPriceResponse } from '@shared/stores/nintendo';

export { parsePriceResponse } from '@shared/stores/nintendo';
export type { CountryPrices, RawPriceResponse } from '@shared/stores/nintendo';

/**
 * The prices the eShop charges at checkout, one country at a time.
 * Throws if any batch fails, so callers never mistake an outage for "not sold".
 */
export async function fetchCountryPrices(country: string, nsuids: string[]): Promise<CountryPrices> {
  const out: CountryPrices = { prices: new Map(), gone: new Set() };
  for (const ids of chunk([...new Set(nsuids.filter(Boolean))], PRICE_BATCH)) {
    const data = await getJson<RawPriceResponse>(`${config.upstream.nintendoPrice}?${qs(priceQuery(country, ids))}`);
    const part = parsePriceResponse(country, data);
    part.prices.forEach((v, k) => out.prices.set(k, v));
    part.gone.forEach((k) => out.gone.add(k));
  }
  return out;
}
