import { titleKey } from '@shared/match';
import type { Game, Platform } from '@shared/types';
import { americasEnabled } from '../config';
import type { Db } from '../db';
import { searchEu } from '../sources/nintendo/catalogEu';
import { searchUs } from '../sources/nintendo/catalogUs';
import { findJapanNsuid } from '../sources/nintendo/catalogJp';
import { listSteamDeals } from '../sources/steam';
import { all, run } from '../db';
import { recordSaleCount } from '../events/run';
import { attachNsuid, gameIdForNsuid, matchCandidates, sourceError, sourceOk, tx, upsertGame, type Group } from '../store';
import { pickMatch } from './match';

type SwitchPlatform = Exclude<Platform, 'steam'>;

/**
 * File one catalog entry under the right game, creating the game if this
 * is the first time any region has listed it. Returns the game id.
 */
export function ingestSwitchEntry(db: Db, grp: Group, nsuid: string, g: Game, rank?: number): string {
  const known = gameIdForNsuid(db, grp, nsuid);
  const meta = {
    platform: g.platform,
    title: g.title,
    image: g.image,
    publisher: g.publisher,
    releaseDate: g.releaseDate,
    productCode: g.productCode,
    storeUrl: g.storeUrl,
    rank,
  };
  if (known) {
    upsertGame(db, { id: known, ...meta });
    return known;
  }
  const match = pickMatch(g, matchCandidates(db, g.platform, titleKey(g.title), grp));
  if (match) {
    // Keep the existing game's id and title; only fill in gaps.
    upsertGame(db, { ...meta, id: match.game.id, title: match.game.title, storeUrl: match.game.store_url ?? g.storeUrl, rank: rank ?? match.game.rank ?? undefined });
    attachNsuid(db, grp, nsuid, match.game.id, match.method);
    return match.game.id;
  }
  const id = `sw:${grp === 'europe' ? 'eu' : grp === 'americas' ? 'us' : 'jp'}:${nsuid}`;
  upsertGame(db, { id, ...meta });
  attachNsuid(db, grp, nsuid, id, 'source');
  return id;
}

export interface SyncOpts {
  platform: SwitchPlatform;
  onSaleOnly: boolean;
  maxPages?: number;
  pageSize?: number;
}

/** Walk Nintendo of Europe's catalog. With onSaleOnly it's the fast deal discovery pass. */
export async function syncEuCatalog(db: Db, o: SyncOpts): Promise<string[]> {
  const pageSize = o.pageSize ?? 100;
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

export async function syncUsCatalog(db: Db, o: SyncOpts): Promise<string[]> {
  if (!americasEnabled()) return [];
  const pageSize = o.pageSize ?? 100;
  const ids: string[] = [];
  try {
    for (let page = 0; page < (o.maxPages ?? 200); page++) {
      const { games, total } = await searchUs({ platform: o.platform, onSale: o.onSaleOnly, page, pageSize });
      tx(db, () => {
        games.forEach((g, i) => ids.push(ingestSwitchEntry(db, 'americas', g.nsuids!.americas!, g, o.onSaleOnly ? undefined : page * pageSize + i)));
      });
      if ((page + 1) * pageSize >= total || games.length === 0) break;
    }
    sourceOk(db, 'nintendo-us-catalog', ids.length);
  } catch (e) {
    sourceError(db, 'nintendo-us-catalog', e);
  }
  return ids;
}

/**
 * Japan lists titles in Japanese, so we only link games whose product code
 * matches. Misses are remembered for a week, so games with no Japanese
 * release don't hog every run, and one failed lookup doesn't stop the rest.
 */
export async function matchJapan(db: Db, limit = 150, now = Date.now()): Promise<number> {
  const rows = all<{ id: string; product_code: string }>(
    db,
    `SELECT g.id, g.product_code FROM games g
     WHERE g.platform != 'steam' AND g.product_code IS NOT NULL
       AND (g.jp_checked_at IS NULL OR g.jp_checked_at < ?)
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.game_id = g.id AND i.grp = 'japan')
     ORDER BY g.jp_checked_at IS NOT NULL, g.on_sale DESC, COALESCE(g.rank, 1e9) LIMIT ?`,
    now - 7 * 86400_000,
    limit,
  );
  let linked = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const nsuid = await findJapanNsuid(r.product_code);
      if (nsuid && !gameIdForNsuid(db, 'japan', nsuid)) {
        attachNsuid(db, 'japan', nsuid, r.id, 'product_code');
        linked++;
      }
      run(db, 'UPDATE games SET jp_checked_at = ? WHERE id = ?', now, r.id);
    } catch (e) {
      errors++;
      if (errors >= 5) {
        // The service is clearly down; try again next run
        sourceError(db, 'nintendo-jp-catalog', e);
        return linked;
      }
    }
  }
  sourceOk(db, 'nintendo-jp-catalog', linked);
  return linked;
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
