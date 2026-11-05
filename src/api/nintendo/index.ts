import type { Game, Platform, RegionPrice } from '../../domain/types';
import { regionsInGroup } from '../../domain/regions';
import { titleKey } from '../../domain/match';
import { getEuByNsuid, searchEu, type EuSort } from './catalogEu';
import { americasCatalogEnabled, getUsByNsuid, searchUs } from './catalogUs';
import { findJapanNsuid } from './catalogJp';
import { fetchPricesByCountry } from './prices';

export { americasCatalogEnabled };

type SwitchPlatform = Exclude<Platform, 'steam'>;

/** Combine listings from the two catalogs, joining entries that are the same game. */
export function mergeCatalogs(eu: Game[], us: Game[]): Game[] {
  const out: Game[] = [];
  const byTitle = new Map<string, Game>();
  for (const g of eu) {
    const copy = { ...g, nsuids: { ...g.nsuids } };
    out.push(copy);
    byTitle.set(`${g.platform}|${titleKey(g.title)}`, copy);
  }
  for (const g of us) {
    const match = byTitle.get(`${g.platform}|${titleKey(g.title)}`);
    if (match) {
      match.nsuids = { ...match.nsuids, americas: g.nsuids?.americas };
      match.image ??= g.image;
      match.listPrice ??= g.listPrice;
    } else {
      out.push(g);
    }
  }
  return out;
}

export interface SwitchListParams {
  platform: SwitchPlatform | 'all';
  query?: string;
  onSale?: boolean;
  sort?: EuSort;
  page?: number;
  pageSize?: number;
}

export async function listSwitchGames(p: SwitchListParams): Promise<{ games: Game[]; total: number; hasMore: boolean }> {
  const [eu, us] = await Promise.all([
    searchEu(p),
    americasCatalogEnabled ? searchUs(p).catch(() => ({ games: [], total: 0 })) : Promise.resolve({ games: [], total: 0 }),
  ]);
  const games = mergeCatalogs(eu.games, us.games);
  const pageSize = p.pageSize ?? 40;
  const page = p.page ?? 0;
  const hasMore = (page + 1) * pageSize < Math.max(eu.total, us.total);
  return { games, total: Math.max(eu.total, us.total), hasMore };
}

/** Price every game in a list across the selected countries. */
export async function priceSwitchGames(games: Game[], countries: string[]): Promise<Map<string, RegionPrice[]>> {
  const requests: { country: string; nsuids: string[] }[] = [];
  for (const group of ['americas', 'europe', 'japan'] as const) {
    const ids = games.map((g) => g.nsuids?.[group]).filter((x): x is string => !!x);
    if (!ids.length) continue;
    for (const r of regionsInGroup(group, countries)) requests.push({ country: r.code, nsuids: ids });
  }
  const byNsuid = await fetchPricesByCountry(requests);
  const byGame = new Map<string, RegionPrice[]>();
  for (const g of games) {
    const list: RegionPrice[] = [];
    for (const group of ['americas', 'europe', 'japan'] as const) {
      const id = g.nsuids?.[group];
      if (!id) continue;
      const groupCountries = new Set(regionsInGroup(group, countries).map((r) => r.code));
      for (const price of byNsuid.get(id) ?? []) if (groupCountries.has(price.country)) list.push(price);
    }
    byGame.set(g.key, list);
  }
  return byGame;
}

/** Look a game up from its route key, e.g. after a deep link or app restart. */
export async function getSwitchGame(key: string): Promise<Game | undefined> {
  const [, source, nsuid] = key.split(':');
  if (source === 'eu') return getEuByNsuid(nsuid);
  if (source === 'us') return getUsByNsuid(nsuid);
  return undefined;
}

/**
 * Fill in the NSUIDs we don't have yet so the detail screen can compare
 * every region. Each lookup is independent and allowed to fail.
 */
export async function resolveAllRegions(game: Game): Promise<Game> {
  const nsuids = { ...game.nsuids };
  const key = titleKey(game.title);
  const sameGame = (g: Game) => g.platform === game.platform && titleKey(g.title) === key;

  const tasks: Promise<void>[] = [];
  let productCode = game.productCode;

  if (!nsuids.europe) {
    tasks.push(
      searchEu({ platform: game.platform as SwitchPlatform, query: game.title, pageSize: 10 })
        .then(({ games }) => {
          const hit = games.find(sameGame);
          if (hit) {
            nsuids.europe = hit.nsuids?.europe;
            productCode ??= hit.productCode;
          }
        })
        .catch(() => undefined),
    );
  }
  if (!nsuids.americas && americasCatalogEnabled) {
    tasks.push(
      searchUs({ platform: game.platform as SwitchPlatform, query: game.title, pageSize: 10 })
        .then(({ games }) => {
          nsuids.americas = games.find(sameGame)?.nsuids?.americas;
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);

  if (!nsuids.japan && productCode) {
    nsuids.japan = await findJapanNsuid(productCode).catch(() => undefined);
  }
  return { ...game, nsuids, productCode };
}
