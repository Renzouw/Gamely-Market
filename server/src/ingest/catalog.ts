import { titleKey } from '@shared/match';
import type { Game, Platform } from '@shared/types';
import { americasEnabled } from '../config';
import type { Db } from '../db';
import { searchEu } from '../sources/nintendo/catalogEu';
import { fetchUsCatalog, searchUs } from '../sources/nintendo/catalogUs';
import { listSteamDeals } from '../sources/steam';
import { recordSaleCount } from '../events/run';
import { attachNsuid, fillGameGaps, gameIdForNsuid, matchCandidates, sourceError, sourceOk, tx, upsertGame } from '../store';
import { pickMatch } from './match';

type SwitchPlatform = Exclude<Platform, 'steam'>;

/**
 * File one catalog entry under the right game, creating the game if this
 * is the first time any region has listed it. Returns the game id.
 *
 * A game belongs to the region that listed it first: that region's catalog
 * keeps its title, image and details up to date. Other regions only fill
 * gaps, so two catalogs never overwrite each other on every sync.
 * `noMatch` files the entry as its own game (its title is shared by more
 * than one listing in its region, so matching by title would be a guess).
 */
export function ingestSwitchEntry(db: Db, grp: 'europe' | 'americas', nsuid: string, g: Game, rank?: number, noMatch = false): string {
  const known = gameIdForNsuid(db, grp, nsuid);
  const prefix = grp === 'europe' ? 'sw:eu:' : 'sw:us:';
  const meta = {
    platform: g.platform,
    title: g.title,
    image: g.image,
    publisher: g.publisher,
    releaseDate: g.releaseDate,
    productCode: g.productCode,
    appId: g.applicationId,
    storeUrl: g.storeUrl,
    rank,
  };
  if (known) {
    if (known.startsWith(prefix)) upsertGame(db, { id: known, ...meta });
    else fillGameGaps(db, known, meta);
    return known;
  }
  const match = noMatch ? undefined : pickMatch(g, matchCandidates(db, g.platform, titleKey(g.title), grp));
  if (match) {
    fillGameGaps(db, match.game.id, meta);
    attachNsuid(db, grp, nsuid, match.game.id, match.method);
    return match.game.id;
  }
  const id = `${prefix}${nsuid}`;
  upsertGame(db, { id, ...meta });
  attachNsuid(db, grp, nsuid, id, 'source');
  return id;
}

export interface SyncOpts {
  platform: SwitchPlatform;
  onSaleOnly: boolean;
  maxPages?: number;
}

/** Walk Nintendo of Europe's catalog. With onSaleOnly it's the fast deal discovery pass. */
export async function syncEuCatalog(db: Db, o: SyncOpts): Promise<string[]> {
  const pageSize = 100;
  const ids: string[] = [];
  try {
    for (let page = 0; page < (o.maxPages ?? 200); page++) {
      const { games, total } = await searchEu({ platform: o.platform, onSale: o.onSaleOnly, sort: 'popular', page, pageSize });
      tx(db, () => {
        games.forEach((g, i) => {
          // Popularity rank only means something across the whole catalog
          const rank = o.onSaleOnly ? undefined : page * pageSize + i;
          ids.push(ingestSwitchEntry(db, 'europe', g.nsuids!.europe!, g, rank));
        });
      });
      // The store's own count of discounted games feeds sale event detection
      if (page === 0 && o.onSaleOnly) recordSaleCount(db, o.platform, total);
      if ((page + 1) * pageSize >= total || games.length === 0) break;
    }
    sourceOk(db, 'nintendo-eu-catalog', ids.length);
  } catch (e) {
    sourceError(db, 'nintendo-eu-catalog', e);
  }
  return ids;
}

/**
 * The Americas' current sales, for the deal discovery pass. A search stops
 * at 1,000 results, so a big sale's long tail waits for the catalog run.
 */
export async function syncUsDeals(db: Db, platform: SwitchPlatform): Promise<string[]> {
  if (!americasEnabled()) return [];
  const pageSize = 100;
  const ids: string[] = [];
  try {
    for (let page = 0; page * pageSize < 1000; page++) {
      const { games, total } = await searchUs({ platform, onSale: true, page, pageSize });
      tx(db, () => games.forEach((g) => ids.push(ingestSwitchEntry(db, 'americas', g.nsuids!.americas!, g))));
      if ((page + 1) * pageSize >= total || games.length === 0) break;
    }
    sourceOk(db, 'nintendo-us-catalog', ids.length);
  } catch (e) {
    sourceError(db, 'nintendo-us-catalog', e);
  }
  return ids;
}

/**
 * The whole Americas catalog, both platforms, in slices (a single search
 * stops at 1,000 results). Games already known from Europe are linked by
 * the usual strict rule; the rest become Americas-only games. A title the
 * Americas list more than once on one platform isn't matched by title at all.
 */
export async function syncUsFullCatalog(db: Db): Promise<string[]> {
  if (!americasEnabled()) return [];
  const ids: string[] = [];
  try {
    const all: Game[] = [];
    const res = await fetchUsCatalog((games) => all.push(...games));
    const seen = new Map<string, number>();
    const titleOf = (g: Game) => `${g.platform}:${titleKey(g.title)}`;
    for (const g of all) seen.set(titleOf(g), (seen.get(titleOf(g)) ?? 0) + 1);
    for (let i = 0; i < all.length; i += 500) {
      tx(db, () => all.slice(i, i + 500).forEach((g) => ids.push(ingestSwitchEntry(db, 'americas', g.nsuids!.americas!, g, g.popularity, seen.get(titleOf(g))! > 1))));
      await new Promise((r) => setImmediate(r)); // let API requests through between batches
    }
    sourceOk(db, 'nintendo-us-catalog', ids.length);
    if (res.truncated) console.log(new Date().toISOString(), `americas: ${res.truncated} games couldn't be read (a slice had over 1,000)`);
  } catch (e) {
    sourceError(db, 'nintendo-us-catalog', e);
  }
  return ids;
}

/** Steam's own specials list, in top-seller order. */
export async function discoverSteamDeals(db: Db, pages = 10): Promise<string[]> {
  const ids: string[] = [];
  try {
    for (let page = 0; page < pages; page++) {
      const res = await listSteamDeals({ country: 'US', currency: 'USD', sort: 'popular', page, pageSize: 50 });
      if (page === 0) recordSaleCount(db, 'steam', res.total);
      tx(db, () => {
        res.games.forEach((g, i) => {
          upsertGame(db, { id: g.key, platform: 'steam', title: g.title, image: g.image, storeUrl: g.storeUrl, steamAppId: g.steamAppId, releaseDate: g.releaseDate, rank: page * 50 + i });
          ids.push(g.key);
        });
      });
      if (!res.hasMore) break;
    }
    sourceOk(db, 'steam-specials', ids.length);
  } catch (e) {
    sourceError(db, 'steam-specials', e);
  }
  return ids;
}
