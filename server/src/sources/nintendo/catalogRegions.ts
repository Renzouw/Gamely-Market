import { config } from '../../config';
import { getJson, getText, qs } from '../http';
import {
  asiaCatalogPlan,
  asiaCatalogQuery,
  asiaSearchUrl,
  eshopTitleUrl,
  jpCatalogQuery,
  parseAsiaResponse,
  parseEshopAppId,
  parseJpResponse,
  type AsiaGroup,
  type AsiaResponse,
  type JpResponse,
  type RegionEntry,
} from '@shared/stores/nintendoRegions';

// Parsing lives in shared/ next to the other Nintendo formats.
export { codeKey, parseAsiaItem, parseEshopAppId, parseJpItem } from '@shared/stores/nintendoRegions';
export type { RegionEntry } from '@shared/stores/nintendoRegions';

/** One page (300 games) of Japan's downloadable games, newest first. */
export async function fetchJpPage(page: number): Promise<{ entries: RegionEntry[]; total: number; count: number }> {
  return parseJpResponse(await getJson<JpResponse>(`${config.upstream.nintendoJpSearch}?${qs(jpCatalogQuery(page))}`));
}

/** Every game Nintendo's Hong Kong or Korea site lists, in two or three requests. */
export async function fetchAsiaCatalog(grp: AsiaGroup): Promise<RegionEntry[]> {
  const url = asiaSearchUrl(grp, config.upstream.nintendoSite);
  const get = (order: 'newest' | 'oldest', page: number) =>
    getJson<AsiaResponse>(`${url}?${qs(asiaCatalogQuery(page, order))}`, { timeoutMs: 90_000 }).then(parseAsiaResponse);
  const first = await get('newest', 0);
  const out = new Map(first.entries.map((e) => [e.nsuid, e]));
  let listed = first.count;
  for (const step of asiaCatalogPlan(first.total).slice(1)) {
    const res = await get(step.order, step.page);
    listed += res.count;
    for (const e of res.entries) out.set(e.nsuid, e);
  }
  // A short answer means the list didn't come back whole; better to keep what we had
  if (listed < first.total * 0.98) throw new Error(`${grp} catalog came back short: ${listed} of ${first.total}`);
  return [...out.values()];
}

/** The application ID on a Hong Kong eShop title page. */
export async function fetchHkAppId(nsuid: string): Promise<string | undefined> {
  return parseEshopAppId(await getText(eshopTitleUrl('HK', 'zh', nsuid, config.upstream.nintendoEshopWeb), { timeoutMs: 30_000 }), nsuid);
}
