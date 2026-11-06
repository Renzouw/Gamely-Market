import { config } from '../config';
import { getJson } from './http';
import { mergeFx, type ErApiResponse, type FrankfurterResponse, type FxQuote } from '@shared/stores/fx';

export { mergeFx } from '@shared/stores/fx';
export type { FxQuote } from '@shared/stores/fx';

export async function fetchFx(wanted: string[]): Promise<FxQuote[]> {
  const ecb = await getJson<FrankfurterResponse>(`${config.upstream.fxPrimary}?base=USD`);
  const missing = wanted.filter((c) => c !== 'USD' && !ecb.rates?.[c]);
  const market = missing.length ? await getJson<ErApiResponse>(config.upstream.fxFallback).catch(() => undefined) : undefined;
  return mergeFx(ecb, market, wanted);
}
