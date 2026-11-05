import { chunk, getJson, qs } from './http';
import { discountPercent } from '../domain/pricing';
import type { Game, RegionPrice } from '../domain/types';

const STORE = 'https://store.steampowered.com';

export function steamImage(appId: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

function steamGame(appId: number, title: string, extra: Partial<Game> = {}): Game {
  return {
    key: `steam:${appId}`,
    platform: 'steam',
    title,
    steamAppId: appId,
    image: steamImage(appId),
    storeUrl: `${STORE}/app/${appId}/`,
    ...extra,
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/* ------------------------------------------------------------------ */
/* Deals: the store's own "specials" search, which returns HTML rows.  */
/* ------------------------------------------------------------------ */

export type SteamSort = 'popular' | 'discount' | 'price' | 'newest' | 'reviews';
const SORTS: Record<SteamSort, string | undefined> = {
  popular: undefined, // relevance, which on specials means top sellers
  discount: undefined, // sorted client side, the store has no discount sort
  price: 'Price_ASC',
  newest: 'Released_DESC',
  reviews: 'Reviews_DESC',
};

interface SearchResultsResponse {
  success?: number;
  results_html?: string;
  total_count?: number;
}

/** Pull games out of the store's search result HTML. Exported for tests. */
export function parseSearchHtml(html: string, currency: string, country: string): Game[] {
  const games: Game[] = [];
  const rows = html.split(/<a\s+href=/).slice(1);
  for (const row of rows) {
    const appIdMatch = row.match(/data-ds-appid="(\d+)"/);
    const titleMatch = row.match(/<span class="title">([\s\S]*?)<\/span>/);
    if (!appIdMatch || !titleMatch) continue; // bundles and packages have no single app id
    const appId = Number(appIdMatch[1]);
    const finalCents = Number(row.match(/data-price-final="(\d+)"/)?.[1]);
    const discount = Number(row.match(/data-discount="(\d+)"/)?.[1] ?? 0);
    const released = row.match(/search_released[^>]*>\s*([^<]*?)\s*</)?.[1];
    let listPrice: RegionPrice | undefined;
    if (Number.isFinite(finalCents)) {
      const final = finalCents / 100;
      const regular = discount > 0 && discount < 100 ? Math.round((final / (1 - discount / 100)) * 100) / 100 : final;
      listPrice = {
        country,
        regular: { amount: regular, currency },
        sale: discount > 0 ? { amount: final, currency } : undefined,
        discountPercent: discount,
      };
    }
    games.push(steamGame(appId, decodeEntities(titleMatch[1].trim()), { listPrice, releaseDate: released || undefined }));
  }
  return games;
}

export async function listSteamDeals(p: {
  country: string;
  currency: string;
  sort?: SteamSort;
  page?: number;
  pageSize?: number;
  query?: string;
}): Promise<{ games: Game[]; total: number; hasMore: boolean }> {
  const pageSize = p.pageSize ?? 50;
  const start = (p.page ?? 0) * pageSize;
  const url =
    `${STORE}/search/results/?` +
    qs({
      term: p.query,
      specials: 1,
      category1: 998, // games only
      infinite: 1,
      json: 1,
      start,
      count: pageSize,
      cc: p.country,
      l: 'english',
      sort_by: SORTS[p.sort ?? 'popular'],
    });
  const data = await getJson<SearchResultsResponse>(url);
  // The HTML only carries prices, not their currency; take it from a region price lookup later.
  const games = parseSearchHtml(data.results_html ?? '', p.currency, p.country);
  const total = data.total_count ?? games.length;
  return { games, total, hasMore: start + games.length < total };
}

/* ------------------------------------------------------------------ */
/* Search: lightweight JSON endpoint used by the store's search box.   */
/* ------------------------------------------------------------------ */

interface StoreSearchResponse {
  total?: number;
  items?: {
    type?: string;
    id: number;
    name: string;
    tiny_image?: string;
    price?: { currency: string; initial: number; final: number };
  }[];
}

export function parseStoreSearch(data: StoreSearchResponse, country: string): Game[] {
  return (data.items ?? [])
    .filter((it) => !it.type || it.type === 'app')
    .map((it) => {
      const listPrice: RegionPrice | undefined = it.price
        ? {
            country,
            regular: { amount: it.price.initial / 100, currency: it.price.currency },
            sale: it.price.final < it.price.initial ? { amount: it.price.final / 100, currency: it.price.currency } : undefined,
            discountPercent: discountPercent(it.price.initial, it.price.final),
          }
        : undefined;
      return steamGame(it.id, it.name, { listPrice });
    });
}

export async function searchSteam(query: string, country: string): Promise<Game[]> {
  const data = await getJson<StoreSearchResponse>(`${STORE}/api/storesearch/?${qs({ term: query, l: 'english', cc: country })}`);
  return parseStoreSearch(data, country);
}

/* ------------------------------------------------------------------ */
/* Regional prices via appdetails (price_overview filter allows batch) */
/* ------------------------------------------------------------------ */

interface PriceOverview {
  currency: string;
  initial: number;
  final: number;
  discount_percent?: number;
}

type AppDetailsPriceResponse = Record<string, { success: boolean; data?: { price_overview?: PriceOverview } | unknown[] }>;

export function parsePriceOverview(country: string, data: AppDetailsPriceResponse): Map<number, RegionPrice> {
  const out = new Map<number, RegionPrice>();
  for (const [id, entry] of Object.entries(data)) {
    if (!entry?.success || !entry.data || Array.isArray(entry.data)) continue;
    const po = (entry.data as { price_overview?: PriceOverview }).price_overview;
    if (!po) continue;
    const onSale = po.final < po.initial;
    out.set(Number(id), {
      country,
      regular: { amount: po.initial / 100, currency: po.currency },
      sale: onSale ? { amount: po.final / 100, currency: po.currency } : undefined,
      discountPercent: onSale ? (po.discount_percent ?? discountPercent(po.initial, po.final)) : 0,
    });
  }
  return out;
}

export async function fetchSteamPrices(appIds: number[], country: string): Promise<Map<number, RegionPrice>> {
  const merged = new Map<number, RegionPrice>();
  const parts = await Promise.all(
    chunk([...new Set(appIds)], 40).map((ids) =>
      getJson<AppDetailsPriceResponse>(
        `${STORE}/api/appdetails?${qs({ appids: ids.join(','), cc: country, filters: 'price_overview' })}`,
      )
        .then((d) => parsePriceOverview(country, d))
        .catch(() => new Map<number, RegionPrice>()),
    ),
  );
  parts.forEach((m) => m.forEach((v, k) => merged.set(k, v)));
  return merged;
}

export async function fetchSteamRegionalPrices(appId: number, countries: string[]): Promise<RegionPrice[]> {
  const results = await Promise.all(countries.map((c) => fetchSteamPrices([appId], c)));
  return results.map((m) => m.get(appId)).filter((p): p is RegionPrice => !!p);
}

/* ------------------------------------------------------------------ */
/* Details for the game screen                                         */
/* ------------------------------------------------------------------ */

export interface SteamDetails {
  title: string;
  description?: string;
  publisher?: string;
  releaseDate?: string;
  image?: string;
  isFree?: boolean;
  metacritic?: number;
  platforms?: string[];
}

interface AppDetailsFull {
  [id: string]: {
    success: boolean;
    data?: {
      name: string;
      short_description?: string;
      publishers?: string[];
      release_date?: { date?: string };
      header_image?: string;
      is_free?: boolean;
      metacritic?: { score?: number };
      platforms?: Record<string, boolean>;
    };
  };
}

export async function fetchSteamDetails(appId: number, country: string): Promise<SteamDetails | undefined> {
  const data = await getJson<AppDetailsFull>(`${STORE}/api/appdetails?${qs({ appids: appId, cc: country, l: 'english' })}`);
  const d = data[String(appId)]?.data;
  if (!d) return undefined;
  return {
    title: d.name,
    description: d.short_description ? decodeEntities(d.short_description.replace(/<[^>]+>/g, '')) : undefined,
    publisher: d.publishers?.[0],
    releaseDate: d.release_date?.date,
    image: d.header_image,
    isFree: d.is_free,
    metacritic: d.metacritic?.score,
    platforms: d.platforms ? Object.entries(d.platforms).filter(([, v]) => v).map(([k]) => k) : undefined,
  };
}

export async function getSteamGame(key: string, country: string): Promise<Game | undefined> {
  const appId = Number(key.split(':')[1]);
  if (!appId) return undefined;
  const d = await fetchSteamDetails(appId, country);
  return d ? steamGame(appId, d.title, { image: d.image ?? steamImage(appId), publisher: d.publisher, releaseDate: d.releaseDate }) : undefined;
}
