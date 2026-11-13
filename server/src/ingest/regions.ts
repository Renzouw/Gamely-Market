import { productCore, titleKey } from '@shared/match';
import { SWITCH_REGIONS } from '@shared/regions';
import { config } from '../config';
import { all, get, run, tx, type Db } from '../db';
import { JP_PAGE_SIZE } from '@shared/stores/nintendoRegions';
import { fetchAsiaCatalog, fetchHkAppId, fetchJpPage, fetchRegionSales, fetchSeaPage, fetchUpgrades, type RegionEntry } from '../sources/nintendo/catalogRegions';
import { attachNsuid, isOverdue, markRun, sourceError, sourceOk, upsertGame, type GameRow } from '../store';

/**
 * Japan, Hong Kong and Korea list games in Japanese, Chinese or Korean, so
 * we never match them by title. Southeast Asia lists them in English but is
 * matched the same way. A game is linked only when an exact ID agrees:
 *
 * 1. Its product code (hardware + 4-character core) matches exactly one
 *    listing in that region, and no other game of ours has the same code.
 * 2. Europe often has no product code (Donkey Kong Bananza doesn't). Then
 *    the application ID, which is the same worldwide, has to match exactly
 *    one Hong Kong listing on the same platform. That listing's product code
 *    then finds the game in Japan and Korea, under the same rule as 1.
 *
 * 3. Southeast Asia lists games in English, so a listing there is also
 *    linked when its exact title (and platform) belongs to only one game of
 *    ours and only one listing there. See linkSeaByTitle.
 *
 * Anything doubtful is left out, and the game page says so.
 */

const REGION_GROUPS = ['japan', 'hongkong', 'korea', 'sea'] as const;
type RegionGroup = (typeof REGION_GROUPS)[number];

const DAY = 86400_000;
/** How far apart Europe's and Hong Kong's release dates can be for an ID check. */
const DATE_WINDOW = 14 * DAY;
/** Most Hong Kong title pages checked for one game. */
const PAGES_PER_GAME = 10;

interface CatalogRow {
  grp: RegionGroup;
  nsuid: string;
  platform: string;
  code_key: string;
  title: string;
  release_date: string | null;
  app_id: string | null;
  app_checked_at: number | null;
  publisher: string | null;
  image: string | null;
  sale_seen_at: number | null;
}

/* ---------------------------------- sync ---------------------------------- */

function saveEntries(db: Db, grp: RegionGroup, entries: RegionEntry[], now: number) {
  tx(db, () => {
    for (const e of entries) {
      run(
        db,
        `INSERT INTO region_catalog (grp, nsuid, platform, code_key, title, release_date, publisher, image, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(grp, nsuid) DO UPDATE SET platform = excluded.platform, code_key = excluded.code_key,
           title = excluded.title, release_date = excluded.release_date, publisher = excluded.publisher,
           image = excluded.image, seen_at = excluded.seen_at`,
        grp,
        e.nsuid,
        e.platform,
        e.codeKey,
        e.title,
        e.releaseDate ?? null,
        e.publisher ?? null,
        e.image ?? null,
        now,
      );
    }
  });
}

/**
 * After reading a whole catalog: forget listings it no longer has, so a
 * stale one can't block a match (by making a code look shared) or be matched.
 * Listings already linked to a game stay; the price check handles delisting.
 */
function dropMissing(db: Db, grp: RegionGroup, now: number) {
  run(
    db,
    `DELETE FROM region_catalog WHERE grp = ? AND seen_at < ?
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = region_catalog.grp AND i.nsuid = region_catalog.nsuid)`,
    grp,
    now,
  );
}

/**
 * A whole-catalog read only counts when it came back whole. Forgetting listings
 * after an empty or cut-short answer would make shared codes look unique (and so
 * link the wrong listing), so it throws instead and the old catalog stays.
 */
function wholeOrThrow(grp: RegionGroup, items: number, total: number) {
  if (!total || items < total * 0.98) throw new Error(`${grp} catalog came back short: ${items} of ${total}`);
}

/**
 * Refresh the regional catalogs. Hong Kong, Korea and Southeast Asia come
 * whole in a few requests. Japan is 50-odd heavy pages, so each run reads
 * the newest few and the whole list once a week.
 */
export async function syncRegionCatalogs(db: Db, now = Date.now()): Promise<void> {
  for (const grp of ['hongkong', 'korea'] as const) {
    try {
      const entries = await fetchAsiaCatalog(grp);
      saveEntries(db, grp, entries, now);
      dropMissing(db, grp, now);
      sourceOk(db, `nintendo-${grp}-catalog`, entries.length);
    } catch (e) {
      sourceError(db, `nintendo-${grp}-catalog`, e);
    }
  }

  // Southeast Asia: about 4,000 games, 14 pages, so the whole list every run
  try {
    let seen = 0;
    let items = 0;
    let total = 0;
    for (let page = 0; ; page++) {
      const res = await fetchSeaPage(page);
      saveEntries(db, 'sea', res.entries, now);
      seen += res.entries.length;
      items += res.count;
      total = res.total;
      if (res.count < JP_PAGE_SIZE || (page + 1) * JP_PAGE_SIZE >= res.total) break;
    }
    wholeOrThrow('sea', items, total);
    dropMissing(db, 'sea', now);
    sourceOk(db, 'nintendo-sea-catalog', seen);
    // The first time its catalog arrives, every game is looked at again, not only those due this week
    if (seen && isOverdue(db, 'sea-first-link', 100 * 365 * DAY, now)) {
      run(db, 'UPDATE games SET region_checked_at = NULL');
      markRun(db, 'sea-first-link', now);
    }
  } catch (e) {
    sourceError(db, 'nintendo-sea-catalog', e);
  }

  const full = isOverdue(db, 'jp-full-catalog', config.regions.fullEveryMs, now);
  let seen = 0;
  try {
    let items = 0;
    let total = 0;
    for (let page = 0; ; page++) {
      if (!full && page >= config.regions.recentPages) break;
      const res = await fetchJpPage(page);
      saveEntries(db, 'japan', res.entries, now);
      seen += res.entries.length;
      items += res.count;
      total = res.total;
      if (res.count < JP_PAGE_SIZE || (page + 1) * JP_PAGE_SIZE >= res.total) break;
    }
    if (full) {
      wholeOrThrow('japan', items, total);
      dropMissing(db, 'japan', now);
      markRun(db, 'jp-full-catalog', now);
    }
    sourceOk(db, 'nintendo-jp-catalog', seen);
  } catch (e) {
    sourceError(db, 'nintendo-jp-catalog', e);
  }
}

/* --------------------------- Southeast Asia titles --------------------------- */

const YEAR = 365 * DAY;

/**
 * Link Southeast Asia's listings by their English title. Europe has no product code
 * for many games (Amnesia: Rebirth, SOMA), so code matching misses them, and they'd
 * never get a price in the Philippines. A listing is linked only when:
 *
 * - its title and platform belong to exactly one of our games, and to no other
 *   listing there (so "Tetris" sold by two publishers is left alone). Europe
 *   sometimes lists a bundle (ID 7007) under the game's own name; the game wins;
 * - the game has no product code that says otherwise (a code another game of ours
 *   also has, often a bundle's, says nothing);
 * - it wasn't released there more than a year before our release date (a much
 *   older listing with the same name is likely a different game). Southeast Asia
 *   dates every game already out when its eShop opened (November 2025) with that
 *   day, so a later date there proves nothing.
 *
 * The listing's product code is then the game's too (when no other game has it),
 * which finds it in Japan, Hong Kong and Korea at the next linkRegions.
 * No network: runs on the catalog already saved. `only` limits it to these listings.
 * Returns the games that gained a link.
 */
export function linkSeaByTitle(db: Db, only?: string[]): string[] {
  const listings = all<CatalogRow>(db, "SELECT * FROM region_catalog WHERE grp = 'sea'");
  const byTitle = new Map<string, CatalogRow[]>();
  for (const r of listings) {
    const k = `${r.platform}|${titleKey(r.title)}`;
    byTitle.set(k, [...(byTitle.get(k) ?? []), r]);
  }
  const ours = gamesByTitle(db);
  const counts = idCounts(db);
  const wanted = only ? new Set(only) : undefined;
  const linked: string[] = [];
  tx(db, () => {
    for (const [k, rows] of byTitle) {
      let gs = ours.get(k);
      if (gs && gs.length > 1) gs = gs.filter((g) => !BUNDLE_ID.test(g.id));
      if (rows.length !== 1 || gs?.length !== 1) continue;
      const [row] = rows;
      const [g] = gs;
      if (wanted && !wanted.has(row.nsuid)) continue;
      if (isLinked(db, 'sea', row.nsuid) || linkedGroups(db, g.id).has('sea')) continue;
      const own = keyOf(g);
      if (own && own !== row.code_key && counts.keys.get(own) === 1) continue;
      const theirs = row.release_date ? Date.parse(row.release_date) : NaN;
      const mine = g.release_date ? Date.parse(g.release_date) : NaN;
      if (Number.isFinite(theirs) && Number.isFinite(mine) && theirs < mine - YEAR) continue;
      attachNsuid(db, 'sea', row.nsuid, g.id, 'title');
      linked.push(g.id);
      if (!g.product_code && !g.code_key && !counts.keys.has(row.code_key)) {
        counts.keys.set(row.code_key, 1);
        // Look for it in the other regions at the next linking, not next week
        run(db, 'UPDATE games SET code_key = ?, region_checked_at = NULL WHERE id = ?', row.code_key, g.id);
      }
    }
  });
  return linked;
}

/** Our games (not Steam, not upgrade packs) by platform and title key */
function gamesByTitle(db: Db): Map<string, GameRow[]> {
  const ours = new Map<string, GameRow[]>();
  for (const g of all<GameRow>(db, "SELECT * FROM games WHERE platform != 'steam' AND id NOT LIKE 'sw:eu:7005%'")) {
    const k = `${g.platform}|${titleKey(g.title)}`;
    ours.set(k, [...(ours.get(k) ?? []), g]);
  }
  return ours;
}

/** Our games (not Steam, not upgrade packs) by product code key */
function gamesByKey(db: Db): Map<string, GameRow[]> {
  const out = new Map<string, GameRow[]>();
  for (const g of all<GameRow>(db, "SELECT * FROM games WHERE platform != 'steam' AND id NOT LIKE 'sw:eu:7005%'")) {
    const k = keyOf(g);
    if (k) out.set(k, [...(out.get(k) ?? []), g]);
  }
  return out;
}

/**
 * Link listings by product code straight away, rather than when linkRegions next
 * looks at the game (weekly): a new listing, or one just seen on sale. Same rule as
 * linkRegions: exactly one game of ours has the code and exactly one listing there
 * does. Southeast Asia sometimes sells two editions under one code; there the one
 * with the game's own title is it. No network. Returns the games that gained a link.
 */
export function linkByCode(db: Db, grp: RegionGroup, only?: string[]): string[] {
  const rows = all<CatalogRow>(
    db,
    'SELECT * FROM region_catalog r WHERE grp = ? AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = r.grp AND i.nsuid = r.nsuid)',
    grp,
  );
  const wanted = only ? new Set(only) : undefined;
  const byKey = gamesByKey(db);
  const linked: string[] = [];
  tx(db, () => {
    for (const r of rows) {
      if (wanted && !wanted.has(r.nsuid)) continue;
      const gs = byKey.get(r.code_key);
      if (gs?.length !== 1) continue;
      const [g] = gs;
      if (g.platform !== r.platform || linkedGroups(db, g.id).has(grp)) continue;
      if (r.app_id && g.app_id && r.app_id !== g.app_id) continue;
      let same = all<CatalogRow>(db, 'SELECT * FROM region_catalog WHERE grp = ? AND code_key = ?', grp, r.code_key);
      if (same.length > 1 && grp === 'sea') same = same.filter((x) => titleKey(x.title) === titleKey(g.title));
      if (same.length !== 1 || same[0].nsuid !== r.nsuid) continue;
      attachNsuid(db, grp, r.nsuid, g.id, 'product_code');
      linked.push(g.id);
    }
  });
  return linked;
}

/** A bundle's ID, which Europe and the Americas sometimes list under the game's own name */
const BUNDLE_ID = /^sw:(eu|us):7007/;

/**
 * Games sold in Southeast Asia but in neither Europe nor the Americas (or under a
 * name and code we can't tie to one there): filed as games of their own,
 * "sw:sea:<nsuid>", so they show up, sales included. Only when no game of ours has
 * the same title and platform, and none that has the listing's product code could
 * still be it (one already linked to another listing there isn't: that's a second
 * edition sharing the code), so a game we already have isn't listed twice. If Europe or the Americas list it later, their catalog
 * matches it like any other game (same title, plus publisher or release date).
 * Run after linkSeaByTitle. `only` limits it to these listings. Returns the new games.
 */
export function addSeaOnlyGames(db: Db, only?: string[], now = Date.now()): string[] {
  return addRegionOnlyGames(db, 'sea', only, now);
}

/** The ID prefix of games filed under a region's own listing */
const OWN_PREFIX = { sea: 'sw:sea:', japan: 'sw:jp:' } as const;

/**
 * addSeaOnlyGames, and the same for Japan: a game Japan sells that Europe and the
 * Americas don't (most are sold only in Japan, or in Asia), filed as "sw:jp:<nsuid>"
 * under its Japanese title. Japan has about 8,000 listings we can't match, so only
 * ones that have been on sale are filed, and only once Hong Kong's page for the same
 * product code has been read (its application ID may yet find the game; see
 * linkJapanByHkApp). Its code then finds it in Hong Kong and Korea too.
 */
export function addRegionOnlyGames(db: Db, grp: 'sea' | 'japan', only?: string[], now = Date.now()): string[] {
  const rows = all<CatalogRow>(
    db,
    `SELECT * FROM region_catalog r WHERE grp = ? ${grp === 'japan' ? 'AND sale_seen_at IS NOT NULL' : ''}
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = r.grp AND i.nsuid = r.nsuid)`,
    grp,
  );
  const prefix = OWN_PREFIX[grp];
  const wanted = only ? new Set(only) : undefined;
  const ours = gamesByTitle(db);
  const byKey = gamesByKey(db);
  const counts = idCounts(db);
  const added: string[] = [];
  tx(db, () => {
    for (const r of rows) {
      if (wanted && !wanted.has(r.nsuid)) continue;
      if (!r.title.trim() || ours.has(`${r.platform}|${titleKey(r.title)}`)) continue;
      if ((byKey.get(r.code_key) ?? []).some((g) => !linkedGroups(db, g.id).has(grp))) continue;
      if (grp === 'japan' && hkTwinUndecided(db, r)) continue;
      const id = `${prefix}${r.nsuid}`;
      upsertGame(db, { id, platform: r.platform as GameRow['platform'], title: r.title, image: r.image ?? undefined, publisher: r.publisher ?? undefined, releaseDate: r.release_date ?? undefined }, now);
      // Its code finds it in the other regions at the next linking, unless another game has it
      if (!counts.keys.has(r.code_key)) run(db, 'UPDATE games SET code_key = ? WHERE id = ?', r.code_key, id);
      counts.keys.set(r.code_key, (counts.keys.get(r.code_key) ?? 0) + 1);
      attachNsuid(db, grp, r.nsuid, id, 'source');
      added.push(id);
    }
    // Ones filed earlier follow their listing's name and picture (only written when changed)
    if (!only) {
      for (const r of all<CatalogRow>(db, `SELECT r.* FROM region_catalog r JOIN games g ON g.id = '${prefix}' || r.nsuid WHERE r.grp = ?`, grp)) {
        upsertGame(db, { id: `${prefix}${r.nsuid}`, platform: r.platform as GameRow['platform'], title: r.title, image: r.image ?? undefined, publisher: r.publisher ?? undefined }, now);
      }
    }
  });
  return added;
}

/**
 * Whether Hong Kong may still tell us which game a Japanese listing is: it lists the
 * same product code under a listing that's linked to a game, or whose page (with the
 * application ID) we haven't read yet.
 */
function hkTwinUndecided(db: Db, r: CatalogRow): boolean {
  return !!get(
    db,
    `SELECT 1 AS x FROM region_catalog h WHERE h.grp = 'hongkong' AND h.code_key = ?
       AND (h.app_checked_at IS NULL OR EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = 'hongkong' AND i.nsuid = h.nsuid))`,
    r.code_key,
  );
}

/**
 * Japan's sales that no product code of ours finds, found through Hong Kong: Japan and
 * Hong Kong share product codes, and Hong Kong's title page names the application ID,
 * the one ID that's the same everywhere (Japan's own pages sit behind a queue). When
 * exactly one game of ours has that ID on that platform, and it has neither a Hong Kong
 * nor a Japan link yet, both listings are its. Reads at most `pages` title pages.
 * Returns the games that gained links.
 */
export async function linkJapanByHkApp(db: Db, pages: number, only?: string[], now = Date.now()): Promise<string[]> {
  const rows = all<CatalogRow>(
    db,
    `SELECT * FROM region_catalog r WHERE grp = 'japan' AND sale_seen_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = 'japan' AND i.nsuid = r.nsuid)
     ORDER BY sale_seen_at DESC`,
  );
  const wanted = only ? new Set(only) : undefined;
  const counts = idCounts(db);
  const budget: Budget = { pages, errors: 0, fetched: 0 };
  const linked: string[] = [];
  for (const r of rows) {
    if (wanted && !wanted.has(r.nsuid)) continue;
    const hk = all<CatalogRow>(db, "SELECT * FROM region_catalog WHERE grp = 'hongkong' AND code_key = ? AND platform = ?", r.code_key, r.platform);
    if (hk.length !== 1 || isLinked(db, 'hongkong', hk[0].nsuid)) continue;
    if (!hk[0].app_checked_at && !(await fillAppIds(db, hk, budget, now))) break;
    const app = hk[0].app_id;
    if (!app || counts.apps.get(`${r.platform}:${app}`) !== 1) continue;
    const g = get<GameRow>(db, "SELECT * FROM games WHERE app_id = ? AND platform = ? AND id NOT LIKE 'sw:eu:7005%'", app, r.platform);
    if (!g) continue;
    const have = linkedGroups(db, g.id);
    if (have.has('hongkong') || have.has('japan')) continue;
    tx(db, () => {
      attachNsuid(db, 'hongkong', hk[0].nsuid, g.id, 'application_id');
      attachNsuid(db, 'japan', r.nsuid, g.id, 'application_id');
      // The code then finds it in Korea and Southeast Asia, unless another game has it
      if (!keyOf(g) && !counts.keys.has(r.code_key)) {
        counts.keys.set(r.code_key, 1);
        run(db, 'UPDATE games SET code_key = ?, region_checked_at = NULL WHERE id = ?', r.code_key, g.id);
      }
    });
    linked.push(g.id);
  }
  if (budget.fetched && budget.errors < 5) sourceOk(db, 'nintendo-hk-titles', budget.fetched);
  return linked;
}

/**
 * What's on sale in Southeast Asia and Japan, as our games. The listings are saved
 * too (a new one may have arrived since the last catalog read), and Southeast
 * Asia's are linked by title if they can be. Returns each group with its games.
 */
export async function syncRegionSales(db: Db, now = Date.now()): Promise<{ grp: 'sea' | 'japan'; countries: string[]; ids: string[] }[]> {
  const out: { grp: 'sea' | 'japan'; countries: string[]; ids: string[] }[] = [];
  for (const grp of ['sea', 'japan'] as const) {
    let entries: RegionEntry[];
    try {
      entries = await fetchRegionSales(grp);
      sourceOk(db, `nintendo-${grp}-sales`, entries.length);
    } catch (e) {
      sourceError(db, `nintendo-${grp}-sales`, e);
      continue;
    }
    saveEntries(db, grp, entries, now);
    const nsuids = entries.map((e) => e.nsuid);
    tx(db, () => nsuids.forEach((n) => run(db, 'UPDATE region_catalog SET sale_seen_at = ? WHERE grp = ? AND nsuid = ?', now, grp, n)));
    linkByCode(db, grp, nsuids);
    if (grp === 'sea') linkSeaByTitle(db, nsuids);
    if (grp === 'japan') await linkJapanByHkApp(db, config.regions.salePagesPerDeals, nsuids, now);
    addRegionOnlyGames(db, grp, nsuids, now);
    const ids = new Set<string>();
    for (const e of entries) {
      const r = get<{ game_id: string }>(db, 'SELECT game_id FROM game_ids WHERE grp = ? AND nsuid = ?', grp, e.nsuid);
      if (r) ids.add(r.game_id);
    }
    out.push({ grp, countries: SWITCH_REGIONS.filter((r) => r.group === grp).map((r) => r.code), ids: [...ids] });
  }
  return out;
}

/* ------------------------------ upgrade packs ------------------------------ */

/**
 * Southeast Asia's and Japan's upgrade packs, tied to ours: a pack carries its
 * Edition's product code, so the one Edition we've linked there with that code
 * leads to our listing of its upgrade pack (from Europe), which gains that
 * region's ID and so gets priced there. Returns the packs that gained one.
 */
export async function linkUpgradePacks(db: Db): Promise<string[]> {
  const linked: string[] = [];
  for (const grp of ['sea', 'japan'] as const) {
    let entries;
    try {
      entries = await fetchUpgrades(grp);
      sourceOk(db, `nintendo-${grp}-upgrades`, entries.length);
    } catch (e) {
      sourceError(db, `nintendo-${grp}-upgrades`, e);
      continue;
    }
    for (const e of entries) {
      if (isLinked(db, grp, e.nsuid)) continue;
      const editions = all<{ game_id: string }>(
        db,
        `SELECT DISTINCT i.game_id FROM region_catalog r JOIN game_ids i ON i.grp = r.grp AND i.nsuid = r.nsuid
         WHERE r.grp = ? AND r.platform = 'switch2' AND r.code_key = ?`,
        grp,
        e.codeKey,
      );
      if (editions.length !== 1) continue;
      const pack = get<{ pack_id: string }>(db, 'SELECT pack_id FROM upgrades WHERE edition_id = ?', editions[0].game_id);
      if (!pack || linkedGroups(db, pack.pack_id).has(grp)) continue;
      attachNsuid(db, grp, e.nsuid, pack.pack_id, 'product_code');
      linked.push(pack.pack_id);
    }
  }
  return [...new Set(linked)];
}

/* --------------------------------- linking -------------------------------- */

/** The game's own product code key, or one learned from Hong Kong earlier. */
function keyOf(g: Pick<GameRow, 'product_code' | 'code_key'>): string | undefined {
  return productCore(g.product_code ?? undefined) ?? g.code_key ?? undefined;
}

function linkedGroups(db: Db, gameId: string): Set<string> {
  return new Set(all<{ grp: string }>(db, 'SELECT grp FROM game_ids WHERE game_id = ?', gameId).map((r) => r.grp));
}

const isLinked = (db: Db, grp: string, nsuid: string) => !!get(db, 'SELECT 1 AS x FROM game_ids WHERE grp = ? AND nsuid = ?', grp, nsuid);

/**
 * The one listing in a region with this key, if there is exactly one. A
 * listing whose application ID we know and which disagrees is not it.
 */
function pickByKey(db: Db, grp: RegionGroup, key: string, appId: string | null): CatalogRow | undefined {
  const rows = all<CatalogRow>(db, 'SELECT * FROM region_catalog WHERE grp = ? AND code_key = ?', grp, key);
  if (rows.length !== 1 || isLinked(db, grp, rows[0].nsuid)) return undefined;
  return rows[0].app_id && appId && rows[0].app_id !== appId ? undefined : rows[0];
}

interface Budget {
  pages: number;
  errors: number;
  fetched: number;
}

/** Look up (once, then remember) the application ID on Hong Kong title pages. */
async function fillAppIds(db: Db, rows: CatalogRow[], budget: Budget, now: number): Promise<boolean> {
  for (const r of rows) {
    if (r.app_checked_at) continue;
    if (budget.pages <= 0 || budget.errors >= 5) return false;
    budget.pages--;
    try {
      r.app_id = await fetchHkAppId(r.nsuid);
      r.app_checked_at = now;
      budget.fetched++;
      run(db, 'UPDATE region_catalog SET app_id = ?, app_checked_at = ? WHERE grp = ? AND nsuid = ?', r.app_id, now, r.grp, r.nsuid);
    } catch (e) {
      budget.errors++;
      if (budget.errors >= 5) sourceError(db, 'nintendo-hk-titles', e);
      return false;
    }
  }
  return true;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

const STOP = new Set(['the', 'of', 'and', 'for', 'nintendo', 'switch', 'edition']);
function titleWords(title: string): Set<string> {
  return new Set(titleKey(title).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
}

/**
 * Find a game in Hong Kong by application ID. Returns the listing, or
 * undefined plus whether the answer is final (false when we ran out of page
 * lookups and should try again next run).
 */
async function hkByAppId(db: Db, g: GameRow, budget: Budget, now: number): Promise<{ row?: CatalogRow; final: boolean }> {
  if (!g.app_id) return { final: true };
  // Listings whose page we already read, on the same platform
  const known = () => all<CatalogRow>(db, "SELECT * FROM region_catalog WHERE grp = 'hongkong' AND app_id = ? AND platform = ?", g.app_id, g.platform);
  let m = known();
  if (m.length) return { row: m.length === 1 && !isLinked(db, 'hongkong', m[0].nsuid) ? m[0] : undefined, final: true };

  // Otherwise read unread pages of listings released around the same time
  const t = g.release_date ? Date.parse(g.release_date) : NaN;
  if (!Number.isFinite(t)) return { final: true };
  const rows = all<CatalogRow>(
    db,
    `SELECT * FROM region_catalog r WHERE r.grp = 'hongkong' AND r.platform = ? AND r.release_date BETWEEN ? AND ? AND r.app_checked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.grp = r.grp AND i.nsuid = r.nsuid)`,
    g.platform,
    day(t - DATE_WINDOW),
    day(t + DATE_WINDOW),
  );
  if (!rows.length) return { final: true };
  if (budget.pages <= 0 || budget.errors >= 5) return { final: false };
  // Most likely first, to spend few lookups: many Hong Kong titles include the
  // English name, and most games launch the same day everywhere. The
  // application ID still decides; this only sets the order.
  const words = titleWords(g.title);
  const score = (r: CatalogRow) => [...titleWords(r.title)].filter((w) => words.has(w)).length;
  const todo = rows
    .map((r) => ({ r, s: score(r), d: Math.abs(Date.parse(r.release_date!) - t) }))
    .sort((a, b) => b.s - a.s || a.d - b.d)
    .slice(0, PAGES_PER_GAME)
    .map((x) => x.r);
  const done = await fillAppIds(db, todo, budget, now);
  m = known();
  if (m.length === 1) return { row: m[0], final: true };
  return { final: done || m.length > 1 };
}

/**
 * How many of our games carry each product code key and each application
 * ID. When two games share one, a listing could belong to either, so
 * neither gets it.
 */
function idCounts(db: Db): { keys: Map<string, number>; apps: Map<string, number> } {
  const keys = new Map<string, number>();
  const apps = new Map<string, number>();
  for (const g of all<Pick<GameRow, 'product_code' | 'code_key' | 'app_id' | 'platform'>>(db, "SELECT product_code, code_key, app_id, platform FROM games WHERE platform != 'steam' AND id NOT LIKE 'sw:eu:7005%'")) {
    const k = keyOf(g);
    if (k) keys.set(k, (keys.get(k) ?? 0) + 1);
    if (g.app_id) apps.set(`${g.platform}:${g.app_id}`, (apps.get(`${g.platform}:${g.app_id}`) ?? 0) + 1);
  }
  return { keys, apps };
}

/**
 * Link games to their Japan, Hong Kong, Korea and Southeast Asia listings. Each game is
 * looked at again after a week, so new listings get picked up. Returns the
 * games that gained a link.
 */
export async function linkRegions(db: Db, now = Date.now()): Promise<string[]> {
  const ready = REGION_GROUPS.filter((grp) => get(db, 'SELECT 1 AS x FROM region_catalog WHERE grp = ? LIMIT 1', grp));
  if (!ready.length) return [];
  const games = all<GameRow>(
    db,
    `SELECT g.* FROM games g
     WHERE g.platform != 'steam' AND g.id NOT LIKE 'sw:eu:7005%' AND (g.region_checked_at IS NULL OR g.region_checked_at < ?)
       AND (SELECT COUNT(*) FROM game_ids i WHERE i.game_id = g.id AND i.grp IN (${REGION_GROUPS.map((x) => `'${x}'`).join(', ')})) < ${REGION_GROUPS.length}
     ORDER BY g.region_checked_at IS NOT NULL, EXISTS (SELECT 1 FROM watches w WHERE w.game_id = g.id) DESC,
       g.on_sale DESC, COALESCE(g.rank, 1e9)`,
    now - 7 * DAY,
  );
  const counts = idCounts(db);
  const appUnique = (g: GameRow) => !!g.app_id && counts.apps.get(`${g.platform}:${g.app_id}`) === 1;
  const budget: Budget = { pages: config.regions.titlePagesPerRun, errors: 0, fetched: 0 };
  const linked = new Set<string>();

  // "Checked" marks are written 100 at a time in one transaction, not one commit per game
  const checked: string[] = [];
  const flush = () => {
    const ids = checked.splice(0);
    if (ids.length) tx(db, () => ids.forEach((id) => run(db, 'UPDATE games SET region_checked_at = ? WHERE id = ?', now, id)));
  };

  let n = 0;
  for (const g of games) {
    // The database calls are synchronous; let API requests through now and then
    if (++n % 100 === 0) {
      flush();
      await new Promise((r) => setImmediate(r));
    }
    const have = linkedGroups(db, g.id);
    let key = keyOf(g);
    let final = true;

    if (key && counts.keys.get(key)! > 1) key = undefined;
    else if (!key && ready.includes('hongkong') && !have.has('hongkong') && appUnique(g)) {
      const hk = await hkByAppId(db, g, budget, now);
      final = hk.final;
      if (hk.row) {
        tx(db, () => attachNsuid(db, 'hongkong', hk.row!.nsuid, g.id, 'application_id'));
        have.add('hongkong');
        linked.add(g.id);
        // Its product code finds the game in the other regions, unless another game of ours already has that code
        if (!counts.keys.has(hk.row.code_key)) {
          key = hk.row.code_key;
          counts.keys.set(key, 1);
          run(db, 'UPDATE games SET code_key = ? WHERE id = ?', key, g.id);
        }
      }
    }

    if (key) {
      for (const grp of ready) {
        if (have.has(grp)) continue;
        let row = pickByKey(db, grp, key, g.app_id);
        // Hong Kong sometimes lists two language versions under one code; the application ID tells them apart
        if (!row && grp === 'hongkong' && appUnique(g)) {
          const rows = all<CatalogRow>(db, "SELECT * FROM region_catalog WHERE grp = 'hongkong' AND code_key = ?", key);
          if (rows.length > 1 && rows.length <= 4) {
            if (!(await fillAppIds(db, rows, budget, now))) final = false;
            const m = rows.filter((r) => r.app_id === g.app_id);
            if (m.length === 1 && !isLinked(db, grp, m[0].nsuid)) row = m[0];
          }
        }
        if (row) {
          attachNsuid(db, grp, row.nsuid, g.id, 'product_code');
          linked.add(g.id);
        }
      }
    }
    // Check again next week, unless we ran out of page lookups or a catalog is missing
    if (final && ready.length === REGION_GROUPS.length) checked.push(g.id);
  }
  flush();
  if (budget.fetched && budget.errors < 5) sourceOk(db, 'nintendo-hk-titles', budget.fetched);
  return [...linked];
}
