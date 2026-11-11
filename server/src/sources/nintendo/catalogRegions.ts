import { config } from '../../config';
import { getJson, getText, HttpError, qs } from '../http';
import { JP_PAGE_SIZE } from '@shared/stores/nintendoRegions';
import {
  ASIA_PAGE_SIZE,
  asiaCatalogPlan,
  asiaCatalogQuery,
  asiaSearchUrl,
  eshopTitleUrl,
  jpCatalogQuery,
  parseAsiaResponse,
  parseEshopAppId,
  parseJpResponse,
  parseUpgradeResponse,
  upgradeQuery,
  type UpgradeGroup,
  type UpgradeEntry,
  type AsiaGroup,
  type AsiaResponse,
  type JpResponse,
  type RegionEntry,
} from '@shared/stores/nintendoRegions';

// Parsing lives in shared/ next to the other Nintendo formats.
export { codeKey, parseEshopAppId } from '@shared/stores/nintendoRegions';
export type { RegionEntry } from '@shared/stores/nintendoRegions';

/** One page (300 games) of Japan's downloadable games, newest first. */
export async function fetchJpPage(page: number): Promise<{ entries: RegionEntry[]; total: number; count: number }> {
  return parseJpResponse(await getJson<JpResponse>(`${config.upstream.nintendoJpSearch}?${qs(jpCatalogQuery(page))}`));
}

/** One page (300 games) of Southeast Asia's downloadable games, newest first. Same format as Japan. */
export async function fetchSeaPage(page: number): Promise<{ entries: RegionEntry[]; total: number; count: number }> {
  return parseJpResponse(await getJson<JpResponse>(`${config.upstream.nintendoSeaSearch}?${qs(jpCatalogQuery(page))}`));
}

/** Every Switch 2 Edition upgrade pack Southeast Asia or Japan sells (100-150, one request). */
export async function fetchUpgrades(grp: UpgradeGroup): Promise<UpgradeEntry[]> {
  const base = grp === 'sea' ? config.upstream.nintendoSeaSearch : config.upstream.nintendoJpSearch;
  const out: UpgradeEntry[] = [];
  for (let page = 0; page < 10; page++) {
    const res = parseUpgradeResponse(await getJson<JpResponse>(`${base}?${qs(upgradeQuery(grp, page))}`));
    out.push(...res.entries);
    if (res.count < JP_PAGE_SIZE || (page + 1) * JP_PAGE_SIZE >= res.total) break;
  }
  return out;
}

/** Every game Nintendo's Hong Kong or Korea site lists, in two or three requests. */
export async function fetchAsiaCatalog(grp: AsiaGroup): Promise<RegionEntry[]> {
  const url = asiaSearchUrl(grp, config.upstream.nintendoSite);
  const get = (order: 'newest' | 'oldest', page: number) =>
    getJson<AsiaResponse>(`${url}?${qs(asiaCatalogQuery(page, order))}`, { timeoutMs: 90_000 }).then(parseAsiaResponse);
  const first = await get('newest', 0);
  const total = first.total;
  if (!total) throw new Error(`${grp} catalog came back empty`);
  // Every page must come back about as full as it should; a short one means the list
  // didn't come back whole, and it's better to keep what we had than to drop listings
  const check = (page: number, count: number) => {
    const expected = Math.min(ASIA_PAGE_SIZE, total - page * ASIA_PAGE_SIZE);
    if (count < expected * 0.98) throw new Error(`${grp} catalog came back short: ${count} of ${expected} on page ${page + 1}`);
  };
  check(0, first.count);
  const out = new Map(first.entries.map((e) => [e.nsuid, e]));
  for (const step of asiaCatalogPlan(total).slice(1)) {
    const res = await get(step.order, step.page);
    check(step.page, res.count);
    for (const e of res.entries) out.set(e.nsuid, e);
  }
  return [...out.values()];
}

/**
 * The application ID on a Hong Kong eShop title page, or null when the title
 * has no single ID. Throws when the page isn't that title's data (an error or
 * challenge page), so it's tried again later instead of remembered as "none".
 */
export async function fetchHkAppId(nsuid: string): Promise<string | null> {
  let page: string;
  try {
    page = await getText(eshopTitleUrl('HK', 'zh', nsuid, config.upstream.nintendoEshopWeb), { timeoutMs: 30_000 });
  } catch (e) {
    // No such page (the title left the store): a final answer, not a failure to retry every run
    if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
  const id = parseEshopAppId(page, nsuid);
  if (id === undefined) throw new Error(`Hong Kong title page ${nsuid} didn't contain the title's data`);
  return id;
}
