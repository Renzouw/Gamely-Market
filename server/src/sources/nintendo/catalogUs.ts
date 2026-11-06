import { americasEnabled, config } from '../../config';
import { getText, HttpError, postJson } from '../http';
import type { Game, Platform } from '@shared/types';
import { discountPercent } from '@shared/pricing';

/**
 * Americas catalog (US, CA, MX, BR, AR, CL, CO, PE share NSUIDs).
 *
 * Nintendo of America's store search runs on Algolia. Unless NA_SEARCH_*
 * env vars give other credentials, we use the search-only key Nintendo's own
 * US store page uses in every visitor's browser, read from that page. If
 * Nintendo changes the key, the next request that's refused reads it again.
 */
const STORE_BASE = 'https://www.nintendo.com';
const IMAGE_BASE = 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_656/b_white/f_auto/q_auto/';

/** Where the key lives on Nintendo's site, and the field names we rely on. If Nintendo changes them, adjust here. */
export const US_SITE = {
  page: '/us/store/games/',
  /** The main script of the store page */
  script: /\/us\/_next\/static\/chunks\/pages\/_app-[a-z0-9]+\.js/,
  /** As written in that script: {appId:"U3B6GR4UA3",appKey:"<32 hex>"} */
  key: /appId:"([A-Z0-9]{8,12})",appKey:"([a-f0-9]{32})"/,
};

const PLATFORM_NAME: Record<Exclude<Platform, 'steam'>, string> = {
  switch2: 'Nintendo Switch 2',
  switch: 'Nintendo Switch',
};

/** Search filters (Algolia syntax) on Nintendo's field names. */
const FILTER = {
  noDlc: 'NOT topLevelFilters:"DLC"',
  deals: 'topLevelFilters:"Deals"',
  platform: (p: Exclude<Platform, 'steam'>) => `corePlatforms:"${PLATFORM_NAME[p]}"`,
  price: (loCents: number, hiCents: number) => `price.finalPrice >= ${(loCents / 100).toFixed(2)} AND price.finalPrice < ${(hiCents / 100).toFixed(2)}`,
};
/** One value per game, used to split a price point that has too many games for one search. */
const SPLIT_BY = ['contentRatingCode', 'playerCount', 'corePlatforms'];
/** Algolia never returns more than this many results for one search. */
const MAX_RESULTS = 1000;

export interface UsHit {
  objectID?: string;
  title?: string;
  nsuid?: string;
  url?: string;
  productImage?: string;
  horizontalHeaderImage?: string;
  softwarePublisher?: string;
  releaseDate?: string;
  platform?: string;
  corePlatforms?: string[];
  popularityRank?: number | null;
  topLevelFilters?: string[];
  price?: { regPrice?: number; finalPrice?: number; salePrice?: number | null };
}

interface AlgoliaResult {
  hits?: UsHit[];
  nbHits?: number;
  facets?: Record<string, Record<string, number>>;
}

interface AlgoliaResponse {
  results?: AlgoliaResult[];
}

export function usPlatform(hit: UsHit): Exclude<Platform, 'steam'> {
  const names = [hit.platform, ...(hit.corePlatforms ?? [])].filter(Boolean).join(' ');
  return /switch\s*2/i.test(names) ? 'switch2' : 'switch';
}

function image(id?: string): string | undefined {
  if (!id) return undefined;
  return /^https?:/.test(id) ? id : IMAGE_BASE + id;
}

/** Full games only (IDs starting 7001): bundles and DLC have their own IDs. */
export function usHitToGame(hit: UsHit): Game | undefined {
  if (!hit.title || !hit.nsuid || !/^7001\d{10}$/.test(hit.nsuid)) return undefined;
  const reg = hit.price?.regPrice;
  const sale = hit.price?.salePrice ?? undefined;
  return {
    key: `sw:us:${hit.nsuid}`,
    platform: usPlatform(hit),
    title: hit.title,
    image: image(hit.productImage ?? hit.horizontalHeaderImage),
    publisher: hit.softwarePublisher,
    releaseDate: hit.releaseDate,
    nsuids: { americas: hit.nsuid },
    storeUrl: hit.url ? `${STORE_BASE}${hit.url}` : undefined,
    popularity: hit.popularityRank ?? undefined,
    listPrice:
      reg !== undefined
        ? {
            country: 'US',
            regular: { amount: reg, currency: 'USD' },
            sale: sale !== undefined && sale < reg ? { amount: sale, currency: 'USD' } : undefined,
            discountPercent: discountPercent(reg, sale),
          }
        : undefined,
  };
}

/* ------------------------------- credentials ------------------------------- */

let found: { appId: string; apiKey: string; at: number } | undefined;

/** Reads the search key from Nintendo's US store page. */
export function parseUsKey(script: string): { appId: string; apiKey: string } | undefined {
  const m = script.match(US_SITE.key);
  return m ? { appId: m[1], apiKey: m[2] } : undefined;
}

async function credentials(refresh = false): Promise<{ appId: string; apiKey: string }> {
  const { appId, apiKey } = config.naSearch;
  if (appId && apiKey) return { appId, apiKey };
  if (found && !refresh && Date.now() - found.at < 24 * 3600_000) return found;
  const page = await getText(`${config.upstream.nintendoSite}${US_SITE.page}`);
  const src = page.match(US_SITE.script)?.[0];
  if (!src) throw new Error('Nintendo’s US store page changed: no main script found');
  const key = parseUsKey(await getText(`${config.upstream.nintendoSite}${src}`));
  if (!key) throw new Error('Nintendo’s US store page changed: no search key found');
  found = { ...key, at: Date.now() };
  return found;
}

/** For tests */
export function forgetUsKey() {
  found = undefined;
}

async function search(params: Record<string, string>): Promise<AlgoliaResult> {
  const call = async (refresh: boolean) => {
    const { appId, apiKey } = await credentials(refresh);
    const data = await postJson<AlgoliaResponse>(
      `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`,
      { requests: [{ indexName: config.naSearch.index, params: new URLSearchParams(params).toString() }] },
      { 'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey },
    );
    return data.results?.[0] ?? {};
  };
  try {
    return await call(false);
  } catch (e) {
    // A refused key usually means Nintendo changed it: read it again once
    if (e instanceof HttpError && (e.status === 401 || e.status === 403) && !(config.naSearch.appId && config.naSearch.apiKey)) return call(true);
    throw e;
  }
}

/* --------------------------------- search --------------------------------- */

export interface UsSearchParams {
  platform: Exclude<Platform, 'steam'> | 'all';
  query?: string;
  onSale?: boolean;
  page?: number;
  pageSize?: number;
}

/** One page of a search. Algolia stops at 1,000 results; fetchUsCatalog reads past that. */
export async function searchUs(p: UsSearchParams): Promise<{ games: Game[]; total: number }> {
  if (!americasEnabled()) return { games: [], total: 0 };
  const filters = [FILTER.noDlc];
  if (p.platform !== 'all') filters.push(FILTER.platform(p.platform));
  if (p.onSale) filters.push(FILTER.deals);
  const result = await search({ query: p.query?.trim() ?? '', hitsPerPage: String(p.pageSize ?? 40), page: String(p.page ?? 0), filters: filters.join(' AND ') });
  const games = (result.hits ?? []).map(usHitToGame).filter((g): g is Game => !!g);
  return { games, total: result.nbHits ?? games.length };
}

export async function getUsByNsuid(nsuid: string): Promise<Game | undefined> {
  const { games } = await searchUs({ platform: 'all', query: nsuid, pageSize: 5 });
  return games.find((g) => g.nsuids?.americas === nsuid);
}

/**
 * Every full game in the Americas catalog. A search returns at most 1,000
 * results, so the catalog is read in slices: by price range, halved until a
 * slice fits, and a single price with too many games (thousands sit at
 * $4.99 or $9.99) is split by age rating, then player count, then platform.
 */
export async function fetchUsCatalog(onPage?: (games: Game[]) => void): Promise<{ games: number; truncated: number; requests: number }> {
  if (!americasEnabled()) return { games: 0, truncated: 0, requests: 0 };
  const seen = new Set<string>();
  let truncated = 0;
  let requests = 0;
  const count = async (filters: string, facet?: string) => {
    requests++;
    return search({ query: '', hitsPerPage: '0', filters, ...(facet ? { facets: JSON.stringify([facet]) } : {}) });
  };
  const take = async (filters: string, n: number) => {
    for (let page = 0; page * 100 < Math.min(n, MAX_RESULTS); page++) {
      requests++;
      const r = await search({ query: '', hitsPerPage: '100', page: String(page), filters });
      const games = (r.hits ?? []).map(usHitToGame).filter((g): g is Game => !!g && !seen.has(g.nsuids!.americas!));
      games.forEach((g) => seen.add(g.nsuids!.americas!));
      if (games.length) onPage?.(games);
      if (!r.hits?.length) break;
    }
  };
  const byFacets = async (filters: string, dims: string[]): Promise<void> => {
    const head = await count(filters, dims[0]);
    const n = head.nbHits ?? 0;
    if (n <= MAX_RESULTS || !dims.length) {
      if (n > MAX_RESULTS) truncated += n - MAX_RESULTS;
      return n ? take(filters, n) : undefined;
    }
    const [dim, ...rest] = dims;
    const values = Object.keys(head.facets?.[dim] ?? {});
    for (const v of values) await byFacets(`${filters} AND ${dim}:"${v}"`, rest);
    // Games with none of those values
    await byFacets([filters, ...values.map((v) => `NOT ${dim}:"${v}"`)].join(' AND '), rest);
  };
  const byPrice = async (lo: number, hi: number): Promise<void> => {
    const filters = `${FILTER.noDlc} AND ${FILTER.price(lo, hi)}`;
    const n = (await count(filters)).nbHits ?? 0;
    if (!n) return;
    if (n <= MAX_RESULTS) return take(filters, n);
    if (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      await byPrice(lo, mid);
      return byPrice(mid, hi);
    }
    return byFacets(filters, SPLIT_BY);
  };
  await byPrice(0, 100_000); // $0.00 to $999.99
  return { games: seen.size, truncated, requests };
}
