import { config } from '../../config';
import { getJson, qs } from '../http';
import { euByNsuidQuery, euSearchQuery, parseEuResponse, type EuResponse, type EuSearchParams } from '@shared/stores/nintendo';
import type { Game } from '@shared/types';

// Parsing lives in shared/ so the app's phone-only mode reads the catalog the same way.
export { EU_PLATFORM_FILTER, euDocToGame, euPlatform } from '@shared/stores/nintendo';
export type { EuDoc, EuSearchParams, EuSort } from '@shared/stores/nintendo';

/** Nintendo of Europe's public game search: the Europe/Oceania/South Africa catalog. */
export async function searchEu(p: EuSearchParams): Promise<{ games: Game[]; total: number }> {
  return parseEuResponse(await getJson<EuResponse>(`${config.upstream.nintendoEuSearch}?${qs(euSearchQuery(p))}`));
}

export async function getEuByNsuid(nsuid: string): Promise<Game | undefined> {
  const { games } = parseEuResponse(await getJson<EuResponse>(`${config.upstream.nintendoEuSearch}?${qs(euByNsuidQuery(nsuid))}`));
  return games[0];
}
