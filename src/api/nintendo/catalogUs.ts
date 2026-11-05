import { postJson } from '../http';
import type { Game, Platform } from '../../domain/types';
import { discountPercent } from '../../domain/pricing';

/**
 * Americas catalog (US, CA, MX, BR, AR, CL, CO, PE share NSUIDs).
 *
 * Nintendo of America has no open catalog endpoint like Europe's. The store
 * search runs on Algolia, so this adapter only switches on when you supply
 * search credentials through env vars (see README). Without them the app
 * still works, it just can't find Americas IDs for a game.
 */
const APP_ID = process.env.EXPO_PUBLIC_NA_SEARCH_APP_ID ?? '';
const API_KEY = process.env.EXPO_PUBLIC_NA_SEARCH_API_KEY ?? '';
const INDEX = process.env.EXPO_PUBLIC_NA_SEARCH_INDEX || 'store_game_en_us';
const STORE_BASE = 'https://www.nintendo.com';
const IMAGE_BASE = 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_656/b_white/f_auto/q_auto/';

export const americasCatalogEnabled = Boolean(APP_ID && API_KEY);

const PLATFORM_NAME: Record<Exclude<Platform, 'steam'>, string> = {
  switch2: 'Nintendo Switch 2',
  switch: 'Nintendo Switch',
};

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
  price?: { regPrice?: number; finalPrice?: number; salePrice?: number | null };
}

interface AlgoliaResponse {
  results?: { hits?: UsHit[]; nbHits?: number }[];
}

export function usPlatform(hit: UsHit): Exclude<Platform, 'steam'> {
  const names = [hit.platform, ...(hit.corePlatforms ?? [])].filter(Boolean).join(' ');
  return /switch\s*2/i.test(names) ? 'switch2' : 'switch';
}

function image(id?: string): string | undefined {
  if (!id) return undefined;
  return /^https?:/.test(id) ? id : IMAGE_BASE + id;
}

export function usHitToGame(hit: UsHit): Game | undefined {
  if (!hit.title || !hit.nsuid) return undefined;
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

export interface UsSearchParams {
  platform: Exclude<Platform, 'steam'> | 'all';
  query?: string;
  onSale?: boolean;
  page?: number;
  pageSize?: number;
}

export async function searchUs(p: UsSearchParams): Promise<{ games: Game[]; total: number }> {
  if (!americasCatalogEnabled) return { games: [], total: 0 };
  const filters: string[] = [];
  if (p.platform !== 'all') filters.push(`corePlatforms:"${PLATFORM_NAME[p.platform]}"`);
  if (p.onSale) filters.push('topLevelFilters:"Deals"');
  const params = new URLSearchParams({
    query: p.query?.trim() ?? '',
    hitsPerPage: String(p.pageSize ?? 40),
    page: String(p.page ?? 0),
    filters: filters.join(' AND '),
  }).toString();

  const data = await postJson<AlgoliaResponse>(
    `https://${APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`,
    { requests: [{ indexName: INDEX, params }] },
    { 'X-Algolia-Application-Id': APP_ID, 'X-Algolia-API-Key': API_KEY },
  );
  const result = data.results?.[0];
  const games = (result?.hits ?? []).map(usHitToGame).filter((g): g is Game => !!g);
  return { games, total: result?.nbHits ?? games.length };
}

export async function getUsByNsuid(nsuid: string): Promise<Game | undefined> {
  const { games } = await searchUs({ platform: 'all', query: nsuid, pageSize: 5 });
  return games.find((g) => g.nsuids?.americas === nsuid);
}
