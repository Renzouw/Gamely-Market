import { getJson } from './http';
import type { FxRates } from '../domain/types';

/** Free daily exchange rates, no key needed. Covers all the eShop currencies. */
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

interface ErApiResponse {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
}

export function parseFx(data: ErApiResponse): FxRates {
  if (data.result !== 'success' || !data.rates) throw new Error('Exchange rates unavailable');
  return {
    base: data.base_code ?? 'USD',
    rates: data.rates,
    updatedAt: (data.time_last_update_unix ?? Date.now() / 1000) * 1000,
  };
}

export async function fetchFx(): Promise<FxRates> {
  return parseFx(await getJson<ErApiResponse>(FX_URL));
}
