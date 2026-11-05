import { config } from '../config';
import { getJson } from './http';

export interface FxQuote {
  currency: string;
  perUsd: number;
  source: 'ecb' | 'market';
  asOf: string;
}

interface FrankfurterResponse {
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
  time_last_update_utc?: string;
}

/**
 * Exchange rates, most trustworthy source first.
 *
 * The European Central Bank's daily reference rates cover most eShop
 * currencies. For the handful it doesn't publish (ARS, CLP, COP, PEN and a
 * few others) we fall back to a market-rate feed, and label those rates so
 * the app can say so.
 */
export function mergeFx(ecb: FrankfurterResponse, market: ErApiResponse | undefined, wanted: string[]): FxQuote[] {
  if (!ecb.rates || ecb.base !== 'USD') throw new Error('ECB rates missing or not USD-based');
  const out = new Map<string, FxQuote>();
  const asOf = ecb.date ?? new Date().toISOString().slice(0, 10);
  out.set('USD', { currency: 'USD', perUsd: 1, source: 'ecb', asOf });
  for (const [cur, rate] of Object.entries(ecb.rates)) {
    if (rate > 0) out.set(cur, { currency: cur, perUsd: rate, source: 'ecb', asOf });
  }
  if (market?.result === 'success' && market.rates) {
    const marketDate = market.time_last_update_utc ? new Date(market.time_last_update_utc).toISOString().slice(0, 10) : asOf;
    for (const cur of wanted) {
      const rate = market.rates[cur];
      if (!out.has(cur) && rate && rate > 0) out.set(cur, { currency: cur, perUsd: rate, source: 'market', asOf: marketDate });
    }
  }
  return [...out.values()];
}

export async function fetchFx(wanted: string[]): Promise<FxQuote[]> {
  const ecb = await getJson<FrankfurterResponse>(`${config.upstream.fxPrimary}?base=USD`);
  const missing = wanted.filter((c) => c !== 'USD' && !ecb.rates?.[c]);
  const market = missing.length ? await getJson<ErApiResponse>(config.upstream.fxFallback).catch(() => undefined) : undefined;
  return mergeFx(ecb, market, wanted);
}
