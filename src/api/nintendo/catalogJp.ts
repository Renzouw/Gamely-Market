import { getJson, qs } from '../http';
import { productCore } from '../../domain/match';

/**
 * Nintendo Japan's public software search. Titles are in Japanese, so we
 * match by product code ("HACPAAAAA") instead of by name. This is best
 * effort: games without a matching code simply won't show a Japan price.
 */
const SEARCH_URL = 'https://search.nintendo.jp/nintendo_soft/search.json';

export interface JpItem {
  nsuid?: string;
  title?: string;
  pcode?: string;
  icode?: string;
}

interface JpResponse {
  result?: { items?: JpItem[] };
}

export function pickJapanMatch(items: JpItem[], productCode: string): string | undefined {
  const want = productCore(productCode);
  if (!want) return undefined;
  const hit = items.find((it) => it.nsuid && productCore(it.pcode ?? it.icode) === want);
  return hit?.nsuid;
}

export async function findJapanNsuid(productCode: string | undefined): Promise<string | undefined> {
  const core = productCore(productCode);
  if (!core) return undefined;
  const url = `${SEARCH_URL}?${qs({ q: core.slice(3), limit: 30, page: 1 })}`;
  const data = await getJson<JpResponse>(url);
  return pickJapanMatch(data.result?.items ?? [], productCode!);
}
