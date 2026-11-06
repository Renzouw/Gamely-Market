/**
 * Exchange rates: European Central Bank reference rates first, a market
 * feed only for currencies the ECB doesn't publish. Shared by the server and
 * the app's phone-only mode. No network code lives here.
 */
import type { FxRates } from '../types';

export const FX_PRIMARY = 'https://api.frankfurter.dev/v1/latest';
export const FX_FALLBACK = 'https://open.er-api.com/v6/latest/USD';

export interface FxQuote {
  currency: string;
  perUsd: number;
  source: 'ecb' | 'market';
  asOf: string;
}

export interface FrankfurterResponse {
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

export interface ErApiResponse {
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

/** Merged quotes as the rates table the price maths uses. */
export function quotesToRates(quotes: FxQuote[], now = Date.now()): FxRates & { sources: Record<string, 'ecb' | 'market'>; asOf: string } {
  return {
    base: 'USD',
    rates: Object.fromEntries(quotes.map((q) => [q.currency, q.perUsd])),
    sources: Object.fromEntries(quotes.map((q) => [q.currency, q.source])),
    asOf: quotes.find((q) => q.source === 'ecb')?.asOf ?? quotes[0]?.asOf ?? '',
    updatedAt: now,
  };
}
