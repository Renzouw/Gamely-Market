import { getJson, qs } from '../http';
import type { Game, Platform } from '../../domain/types';

/**
 * Nintendo of Europe's public game search (Solr). It covers the shared
 * Europe/Oceania/South Africa catalog and needs no key, so it doubles as
 * our always-available game directory.
 */
const SEARCH_URL = 'https://searching.nintendo-europe.com/en/select';
const STORE_BASE = 'https://www.nintendo.com/en-gb';

/**
 * Platform filters. "HAC" is the Switch hardware code and "BEE" is Switch 2.
 * If Nintendo changes its fields, this is the one place to adjust.
 */
export const EU_PLATFORM_FILTER: Record<Exclude<Platform, 'steam'>, string> = {
  switch2: '(playable_on_txt:"BEE" OR system_names_txt:"Nintendo Switch 2")',
  switch: '(playable_on_txt:"HAC" AND -playable_on_txt:"BEE" AND -system_names_txt:"Nintendo Switch 2")',
};

export type EuSort = 'popular' | 'discount' | 'newest' | 'price' | 'title';

const SORTS: Record<EuSort, string> = {
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
}

interface EuResponse {
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
    popularity: doc.popularity,
    storeUrl: doc.url ? `${STORE_BASE}${doc.url}` : undefined,
  };
}

/** Escape user input for a Solr query. */
function solrEscape(s: string): string {
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

export async function searchEu(p: EuSearchParams): Promise<{ games: Game[]; total: number }> {
  const pageSize = p.pageSize ?? 40;
  const fq = ['type:GAME'];
  if (p.platform !== 'all') fq.push(EU_PLATFORM_FILTER[p.platform]);
  else fq.push(`(${EU_PLATFORM_FILTER.switch2} OR playable_on_txt:"HAC")`);
  if (p.onSale) fq.push('price_has_discount_b:true');

  const q = p.query?.trim() ? solrEscape(p.query.trim()) : '*';
  const url =
    `${SEARCH_URL}?` +
    qs({
      q,
      wt: 'json',
      rows: pageSize,
      start: (p.page ?? 0) * pageSize,
      sort: p.query?.trim() ? undefined : SORTS[p.sort ?? 'popular'],
      fq: fq.join(' AND '),
    });
  const data = await getJson<EuResponse>(url);
  const games = (data.response?.docs ?? []).map(euDocToGame).filter((g): g is Game => !!g);
  return { games, total: data.response?.numFound ?? games.length };
}

export async function getEuByNsuid(nsuid: string): Promise<Game | undefined> {
  const url = `${SEARCH_URL}?${qs({ q: '*', wt: 'json', rows: 1, fq: `nsuid_txt:"${solrEscape(nsuid)}"` })}`;
  const data = await getJson<EuResponse>(url);
  const doc = data.response?.docs?.[0];
  return doc ? euDocToGame(doc) : undefined;
}
