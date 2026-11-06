import { config } from '../../config';
import { getJson, qs } from '../http';
import { jpSearchQuery, pickJapanMatch, type JpResponse } from '@shared/stores/nintendo';

export { pickJapanMatch } from '@shared/stores/nintendo';
export type { JpItem } from '@shared/stores/nintendo';

/** Japan lists titles in Japanese, so games are matched by product code. */
export async function findJapanNsuid(productCode: string | undefined): Promise<string | undefined> {
  const q = productCode ? jpSearchQuery(productCode) : undefined;
  if (!q) return undefined;
  const data = await getJson<JpResponse>(`${config.upstream.nintendoJpSearch}?${qs(q)}`);
  return pickJapanMatch(data.result?.items ?? [], productCode!);
}
