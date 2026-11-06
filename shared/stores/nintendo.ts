/**
 * Nintendo eShop responses: parsing and request building, shared by the
 * server and the app's phone-only mode. No network code lives here.
 */
import { discountPercent } from '../pricing';
import type { Game, Platform, RegionPrice } from '../types';

export const NINTENDO_EU_SEARCH = 'https://searching.nintendo-europe.com/en/select';
export const NINTENDO_PRICE = 'https://api.ec.nintendo.com/v1/price';
const STORE_BASE = 'https://www.nintendo.com/en-gb';

/* ------------------------------ Europe catalog ------------------------------ */

/**
 * Platform filters. "HAC" is the Switch hardware code and "BEE" is Switch 2.
 * If Nintendo changes its fields, this is the one place to adjust.
 */
export const EU_PLATFORM_FILTER: Record<Exclude<Platform, 'steam'>, string> = {
  switch2: '(playable_on_txt:"BEE" OR system_names_txt:"Nintendo Switch 2")',
  switch: '(playable_on_txt:"HAC" AND -playable_on_txt:"BEE" AND -system_names_txt:"Nintendo Switch 2")',
};

export type EuSort = 'popular' | 'discount' | 'newest' | 'price' | 'title';

export const EU_SORTS: Record<EuSort, string> = {
  popular: 'popularity asc',
  discount: 'price_discount_percentage_f desc',
  newest: 'dates_released_dts desc',
  price: 'price_sorting_f asc',
  title: 'sorting_title asc',
};

export interface EuDoc {
  title?: string;
  nsuid_txt?: string[];
  product_code_txt?: string[];
  image_url?: string;
  image_url_h2x1_s?: string;
  image_url_sq_s?: string;
  url?: string;
  publisher?: string;
  dates_released_dts?: string[];
  playable_on_txt?: string[];
  system_names_txt?: string[];
  popularity?: number;
  price_has_discount_b?: boolean;
  /** The application ID, the same in every region. See nintendoRegions.ts. */
  application_id_s?: string;
}

export interface EuResponse {
  response?: { numFound?: number; docs?: EuDoc[] };
}

export function euPlatform(doc: EuDoc): Exclude<Platform, 'steam'> {
  const onBee = doc.playable_on_txt?.some((p) => p.toUpperCase() === 'BEE');
  const named = doc.system_names_txt?.some((s) => /switch\s*2/i.test(s));
  const code = doc.product_code_txt?.some((c) => c.toUpperCase().startsWith('BEE'));
  return onBee || named || code ? 'switch2' : 'switch';
}

function https(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith('//') ? `https:${url}` : url.replace(/^http:/, 'https:');
}

export function euDocToGame(doc: EuDoc): Game | undefined {
  const nsuid = doc.nsuid_txt?.[0];
  if (!doc.title || !nsuid) return undefined;
  return {
    key: `sw:eu:${nsuid}`,
    platform: euPlatform(doc),
    title: doc.title,
    image: https(doc.image_url_h2x1_s ?? doc.image_url ?? doc.image_url_sq_s),
    publisher: doc.publisher,
    releaseDate: doc.dates_released_dts?.[0],
    nsuids: { europe: nsuid },
    productCode: doc.product_code_txt?.[0],
    applicationId: doc.application_id_s?.toLowerCase(),
    popularity: doc.popularity,
    storeUrl: doc.url ? `${STORE_BASE}${doc.url}` : undefined,
  };
}

/** Escape user input for a Solr query. */
export function solrEscape(s: string): string {
  return s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

export interface EuSearchParams {
  platform: Exclude<Platform, 'steam'> | 'all';
  query?: string;
  onSale?: boolean;
  sort?: EuSort;
  page?: number;
  pageSize?: number;
}

/** Query string values for a catalog search. */
export function euSearchQuery(p: EuSearchParams) {
  const pageSize = p.pageSize ?? 40;
  const fq = ['type:GAME'];
  if (p.platform !== 'all') fq.push(EU_PLATFORM_FILTER[p.platform]);
  else fq.push(`(${EU_PLATFORM_FILTER.switch2} OR playable_on_txt:"HAC")`);
  if (p.onSale) fq.push('price_has_discount_b:true');
  const term = p.query?.trim();
  return {
    q: term ? solrEscape(term) : '*',
    wt: 'json',
    rows: pageSize,
    start: (p.page ?? 0) * pageSize,
    sort: term ? undefined : EU_SORTS[p.sort ?? 'popular'],
    fq: fq.join(' AND '),
  };
}

export function euByNsuidQuery(nsuid: string) {
  return { q: '*', wt: 'json', rows: 1, fq: `nsuid_txt:"${solrEscape(nsuid)}"` };
}

export function parseEuResponse(data: EuResponse): { games: Game[]; total: number } {
  const games = (data.response?.docs ?? []).map(euDocToGame).filter((g): g is Game => !!g);
  return { games, total: data.response?.numFound ?? games.length };
}

/* -------------------------------- Price API -------------------------------- */

/** Up to 50 NSUIDs per call, one country at a time. */
export const PRICE_BATCH = 50;

export function priceQuery(country: string, nsuids: string[]) {
  return { country, lang: country === 'JP' ? 'ja' : 'en', ids: nsuids.join(',') };
}

export interface RawAmount {
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
