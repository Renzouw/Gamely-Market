import { config } from '../config';
import { chunk, getJson, qs } from './http';
import {
  getItemsInput,
  parsePriceOverview,
  parseSearchHtml,
  parseStoreItems,
  parseStoreSearch,
  steamSearchQuery,
  type AppDetailsPriceResponse,
  type GetItemsResponse,
  type SearchResultsResponse,
  type SteamItemInfo,
  type SteamSort,
  type StoreSearchResponse,
} from '@shared/stores/steam';
import type { Game, RegionPrice } from '@shared/types';

// Parsing lives in shared/ so the app's phone-only mode reads Steam the same way.
export { parsePriceOverview, parseSearchHtml, parseStoreItems, parseStoreSearch } from '@shared/stores/steam';

const STORE = config.upstream.steamStore;

export async function listSteamDeals(p: {
  country: string;
  currency: string;
  sort?: SteamSort;
  page?: number;
  pageSize?: number;
  query?: string;
}): Promise<{ games: Game[]; total: number; hasMore: boolean }> {
  const q = steamSearchQuery(p);
  const data = await getJson<SearchResultsResponse>(`${STORE}/search/results/?${qs(q)}`);
  const games = parseSearchHtml(data.results_html ?? '', p.currency, p.country);
  const total = data.total_count ?? games.length;
  return { games, total, hasMore: q.start + games.length < total };
}

export async function searchSteam(query: string, country: string): Promise<Game[]> {
  const data = await getJson<StoreSearchResponse>(`${STORE}/api/storesearch/?${qs({ term: query, l: 'english', cc: country })}`);
  return parseStoreSearch(data, country);
}

/** Throws on failure so an outage is never mistaken for "not sold". */
export async function fetchSteamPrices(appIds: number[], country: string): Promise<Map<number, RegionPrice>> {
  const merged = new Map<number, RegionPrice>();
  for (const ids of chunk([...new Set(appIds)], 40)) {
    const d = await getJson<AppDetailsPriceResponse>(`${STORE}/api/appdetails?${qs({ appids: ids.join(','), cc: country, filters: 'price_overview' })}`);
    parsePriceOverview(country, d).forEach((v, k) => merged.set(k, v));
  }
  return merged;
}

export async function fetchSteamItems(appIds: number[], country: string, currency: string): Promise<Map<number, SteamItemInfo>> {
  const merged = new Map<number, SteamItemInfo>();
  for (const ids of chunk([...new Set(appIds)], 100)) {
    const data = await getJson<GetItemsResponse>(
      `${config.upstream.steamApi}/IStoreBrowseService/GetItems/v1/?${qs({ input_json: JSON.stringify(getItemsInput(ids, country)) })}`,
    );
    parseStoreItems(country, currency, data).forEach((v, k) => merged.set(k, v));
  }
  return merged;
}

/** Ask appdetails which currency Steam charges in a country, using a long-lived paid app. */
export async function detectSteamCurrency(country: string, probeAppId = 220): Promise<string | undefined> {
  const prices = await fetchSteamPrices([probeAppId], country);
  return prices.get(probeAppId)?.regular.currency;
}
