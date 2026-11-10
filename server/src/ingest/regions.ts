import { productCore, titleKey } from '@shared/match';
import { config } from '../config';
import { all, get, run, tx, type Db } from '../db';
import { JP_PAGE_SIZE } from '@shared/stores/nintendoRegions';
import { fetchAsiaCatalog, fetchHkAppId, fetchJpPage, fetchSeaPage, type RegionEntry } from '../sources/nintendo/catalogRegions';
import { attachNsuid, isOverdue, markRun, sourceError, sourceOk, type GameRow } from '../store';

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
}

/* ---------------------------------- sync ---------------------------------- */

function saveEntries(db: Db, grp: RegionGroup, entries: RegionEntry[], now: number) {
  tx(db, () => {
    for (const e of entries) {
      run(
        db,
        `INSERT INTO region_catalog (grp, nsuid, platform, code_key, title, release_date, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(grp, nsuid) DO UPDATE SET platform = excluded.platform, code_key = excluded.code_key,
           title = excluded.title, release_date = excluded.release_date, seen_at = excluded.seen_at`,
        grp,
        e.nsuid,
        e.platform,
        e.codeKey,
        e.title,
        e.releaseDate ?? null,
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
    for (let page = 0; ; page++) {
      const res = await fetchSeaPage(page);
      saveEntries(db, 'sea', res.entries, now);
      seen += res.entries.length;
      if (res.count < JP_PAGE_SIZE || (page + 1) * JP_PAGE_SIZE >= res.total) break;
    }
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
    for (let page = 0; ; page++) {
      if (!full && page >= config.regions.recentPages) break;
      const res = await fetchJpPage(page);
      saveEntries(db, 'japan', res.entries, now);
      seen += res.entries.length;
      if (res.count < JP_PAGE_SIZE || (page + 1) * JP_PAGE_SIZE >= res.total) break;
    }
    if (full) {
      dropMissing(db, 'japan', now);
      markRun(db, 'jp-full-catalog', now);
    }
    sourceOk(db, 'nintendo-jp-catalog', seen);
  } catch (e) {
    sourceError(db, 'nintendo-jp-catalog', e);
  }
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
  for (const g of all<Pick<GameRow, 'product_code' | 'code_key' | 'app_id' | 'platform'>>(db, "SELECT product_code, code_key, app_id, platform FROM games WHERE platform != 'steam'")) {
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
     WHERE g.platform != 'steam' AND (g.region_checked_at IS NULL OR g.region_checked_at < ?)
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
