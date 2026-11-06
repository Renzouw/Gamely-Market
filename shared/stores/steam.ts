/**
 * Steam store responses: parsing and request building, shared by the server
 * and the app's phone-only mode. No network code lives here.
 */
import { discountPercent } from '../pricing';
import type { Game, RegionPrice } from '../types';

export const STEAM_STORE_PUBLIC = 'https://store.steampowered.com';

export function steamImage(appId: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

export function steamGame(appId: number, title: string, extra: Partial<Game> = {}): Game {
  return {
    key: `steam:${appId}`,
    platform: 'steam',
    title,
    steamAppId: appId,
    image: steamImage(appId),
    storeUrl: `${STEAM_STORE_PUBLIC}/app/${appId}/`,
    ...extra,
  };
}

export function decodeEntities(s: string): string {
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
export const STEAM_SORTS: Record<SteamSort, string | undefined> = {
  popular: undefined, // relevance, which on specials means top sellers
  discount: undefined, // sorted client side, the store has no discount sort
  price: 'Price_ASC',
  newest: 'Released_DESC',
  reviews: 'Reviews_DESC',
};

export interface SearchResultsResponse {
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

/* ------------------------------------------------------------------ */
/* Search: lightweight JSON endpoint used by the store's search box.   */
/* ------------------------------------------------------------------ */

export interface StoreSearchResponse {
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



/* ------------------------------------------------------------------ */
/* Regional prices via appdetails (price_overview filter allows batch) */
/* ------------------------------------------------------------------ */

export interface PriceOverview {
  currency: string;
  initial: number;
  final: number;
  discount_percent?: number;
}

export type AppDetailsPriceResponse = Record<string, { success: boolean; data?: { price_overview?: PriceOverview } | unknown[] }>;

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

export interface AppDetailsFull {
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



/* ------------------------------------------------------------------ */
/* Batch prices with sale end dates: IStoreBrowseService/GetItems      */
/* ------------------------------------------------------------------ */

export interface StoreItem {
  appid?: number;
  id?: number;
  success?: number;
  visible?: boolean;
  name?: string;
  is_free?: boolean;
  best_purchase_option?: {
    final_price_in_cents?: string;
    original_price_in_cents?: string;
    discount_pct?: number;
    active_discounts?: { discount_end_date?: number }[];
  };
  basic_info?: { publishers?: { name?: string }[] };
  release?: { steam_release_date?: number };
}

export interface GetItemsResponse {
  response?: { store_items?: StoreItem[] };
}

export interface SteamItemInfo {
  price?: RegionPrice;
  free: boolean;
  name?: string;
  publisher?: string;
  releaseDate?: string;
}

/**
 * The store API only gives prices in cents without a currency code, so the
 * caller passes the currency Steam uses in that country (verified daily
 * against appdetails, which does report it).
 */
export function parseStoreItems(country: string, currency: string, data: GetItemsResponse): Map<number, SteamItemInfo> {
  const out = new Map<number, SteamItemInfo>();
  for (const it of data.response?.store_items ?? []) {
    const appId = it.appid ?? it.id;
    if (!appId || it.success !== 1) continue;
    const bpo = it.best_purchase_option;
    const info: SteamItemInfo = {
      free: !!it.is_free,
      name: it.name,
      publisher: it.basic_info?.publishers?.[0]?.name,
      releaseDate: it.release?.steam_release_date ? new Date(it.release.steam_release_date * 1000).toISOString() : undefined,
    };
    const final = Number(bpo?.final_price_in_cents);
    if (bpo && Number.isFinite(final)) {
      const original = Number(bpo.original_price_in_cents ?? final);
      const onSale = original > final;
      const ends = bpo.active_discounts?.map((d) => d.discount_end_date ?? 0).filter((t) => t > 0);
      info.price = {
        country,
        regular: { amount: original / 100, currency },
        sale: onSale ? { amount: final / 100, currency } : undefined,
        discountPercent: onSale ? (bpo.discount_pct ?? discountPercent(original, final)) : 0,
        saleEndsAt: onSale && ends?.length ? new Date(Math.min(...ends) * 1000).toISOString() : undefined,
      };
    } else if (info.free) {
      info.price = { country, regular: { amount: 0, currency }, discountPercent: 0 };
    }
    out.set(appId, info);
  }
  return out;
}



/** Query for the store's specials search (returns HTML rows). */
export function steamSearchQuery(p: { country: string; sort?: SteamSort; page?: number; pageSize?: number; query?: string }) {
  const pageSize = p.pageSize ?? 50;
  return {
    term: p.query,
    specials: 1,
    category1: 998, // games only
    infinite: 1,
    json: 1,
    start: (p.page ?? 0) * pageSize,
    count: pageSize,
    cc: p.country,
    l: 'english',
    sort_by: STEAM_SORTS[p.sort ?? 'popular'],
  };
}

/** The `input_json` for IStoreBrowseService/GetItems. */
export function getItemsInput(appIds: number[], country: string) {
  return {
    ids: appIds.map((appid) => ({ appid })),
    context: { language: 'english', country_code: country, steam_realm: 1 },
    data_request: { include_basic_info: true, include_release: true },
  };
}
