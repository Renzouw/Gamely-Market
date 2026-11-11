import { titleKey } from '@shared/match';
import type { ApiGame, ApiPrice } from '@shared/api';
import type { Platform, RegionPrice, ShopGroup } from '@shared/types';
import { all, get, placeholders, run, tx, type Db } from './db';

/** Nintendo's ID groups: games keep one NSUID per group. */
export type Group = Exclude<ShopGroup, 'steam'>;
export const GROUPS: Group[] = ['americas', 'europe', 'japan', 'hongkong', 'korea', 'sea'];

export interface GameRow {
  id: string;
  platform: Platform;
  title: string;
  title_key: string;
  image: string | null;
  publisher: string | null;
  release_date: string | null;
  product_code: string | null;
  app_id: string | null;
  code_key: string | null;
  region_checked_at: number | null;
  store_url: string | null;
  steam_app_id: number | null;
  rank: number | null;
  on_sale: number;
  max_discount: number;
  sale_ends_at: string | null;
  created_at: number;
  updated_at: number;
}

export interface PriceRow {
  game_id: string;
  country: string;
  currency: string;
  regular: number;
  sale: number | null;
  discount: number;
  sale_ends_at: string | null;
  checked_at: number;
  changed_at: number;
}

export interface GameInput {
  id: string;
  platform: Platform;
  title: string;
  image?: string;
  publisher?: string;
  releaseDate?: string;
  productCode?: string;
  appId?: string;
  storeUrl?: string;
  steamAppId?: number;
  rank?: number;
}

/* ------------------------------- games -------------------------------- */

export function upsertGame(db: Db, g: GameInput, now = Date.now()) {
  run(
    db,
    `INSERT INTO games (id, platform, title, title_key, image, publisher, release_date, product_code, app_id, store_url, steam_app_id, rank, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, title_key = excluded.title_key,
       image = COALESCE(excluded.image, games.image),
       publisher = COALESCE(excluded.publisher, games.publisher),
       release_date = COALESCE(excluded.release_date, games.release_date),
       product_code = COALESCE(excluded.product_code, games.product_code),
       app_id = COALESCE(excluded.app_id, games.app_id),
       store_url = COALESCE(games.store_url, excluded.store_url),
       rank = COALESCE(excluded.rank, games.rank),
       updated_at = excluded.updated_at
     -- Catalog syncs pass the same games again and again: only write when something changes
     WHERE games.title IS NOT excluded.title
        OR (excluded.image IS NOT NULL AND excluded.image IS NOT games.image)
        OR (excluded.publisher IS NOT NULL AND excluded.publisher IS NOT games.publisher)
        OR (excluded.release_date IS NOT NULL AND excluded.release_date IS NOT games.release_date)
        OR (excluded.product_code IS NOT NULL AND excluded.product_code IS NOT games.product_code)
        OR (excluded.app_id IS NOT NULL AND excluded.app_id IS NOT games.app_id)
        OR (games.store_url IS NULL AND excluded.store_url IS NOT NULL)
        OR (excluded.rank IS NOT NULL AND excluded.rank IS NOT games.rank)`,
    g.id,
    g.platform,
    g.title,
    titleKey(g.title),
    g.image ?? null,
    g.publisher ?? null,
    g.releaseDate ?? null,
    g.productCode ?? null,
    g.appId ?? null,
    g.storeUrl ?? null,
    g.steamAppId ?? null,
    g.rank ?? null,
    now,
    now,
  );
}

/** Another region's listing of a game we already have: fill only what's missing, never overwrite. */
export function fillGameGaps(db: Db, id: string, g: Omit<GameInput, 'id' | 'title' | 'platform'>, now = Date.now()) {
  run(
    db,
    `UPDATE games SET
       image = COALESCE(image, ?), publisher = COALESCE(publisher, ?), release_date = COALESCE(release_date, ?),
       product_code = COALESCE(product_code, ?), app_id = COALESCE(app_id, ?), store_url = COALESCE(store_url, ?),
       rank = COALESCE(rank, ?), updated_at = ?
     WHERE id = ?`,
    g.image ?? null,
    g.publisher ?? null,
    g.releaseDate ?? null,
    g.productCode ?? null,
    g.appId ?? null,
    g.storeUrl ?? null,
    g.rank ?? null,
    now,
    id,
  );
}

export function getGame(db: Db, id: string): GameRow | undefined {
  return get<GameRow>(db, 'SELECT * FROM games WHERE id = ?', id);
}

export function getGames(db: Db, ids: string[]): GameRow[] {
  if (!ids.length) return [];
  return all<GameRow>(db, `SELECT * FROM games WHERE id IN (${placeholders(ids.length)})`, ...ids);
}

export function gameIdForNsuid(db: Db, grp: Group, nsuid: string): string | undefined {
  return get<{ game_id: string }>(db, 'SELECT game_id FROM game_ids WHERE grp = ? AND nsuid = ?', grp, nsuid)?.game_id;
}

export function nsuidsForGames(db: Db, ids: string[]): Map<string, Partial<Record<Group, string>>> {
  const out = new Map<string, Partial<Record<Group, string>>>();
  if (!ids.length) return out;
  for (const r of all<{ game_id: string; grp: Group; nsuid: string }>(
    db,
    `SELECT game_id, grp, nsuid FROM game_ids WHERE game_id IN (${placeholders(ids.length)})`,
    ...ids,
  )) {
    const m = out.get(r.game_id) ?? {};
    m[r.grp] = r.nsuid;
    out.set(r.game_id, m);
  }
  return out;
}

export function attachNsuid(db: Db, grp: Group, nsuid: string, gameId: string, method: string) {
  run(db, 'INSERT OR IGNORE INTO game_ids (grp, nsuid, game_id, match_method) VALUES (?, ?, ?, ?)', grp, nsuid, gameId, method);
}

/** Games with the same platform and title that don't have an ID in this group yet */
export function matchCandidates(db: Db, platform: Platform, key: string, grp: Group): GameRow[] {
  return all<GameRow>(
    db,
    `SELECT g.* FROM games g
     WHERE g.platform = ? AND g.title_key = ? AND g.id NOT LIKE 'sw:eu:7005%'
       AND NOT EXISTS (SELECT 1 FROM game_ids i WHERE i.game_id = g.id AND i.grp = ?)`,
    platform,
    key,
    grp,
  );
}

/* ------------------------------- prices ------------------------------- */

export function pricesFor(db: Db, ids: string[], countries?: string[]): Map<string, PriceRow[]> {
  const out = new Map<string, PriceRow[]>();
  if (!ids.length) return out;
  let sql = `SELECT * FROM prices WHERE game_id IN (${placeholders(ids.length)})`;
  const params: string[] = [...ids];
  if (countries?.length) {
    sql += ` AND country IN (${placeholders(countries.length)})`;
    params.push(...countries);
  }
  for (const r of all<PriceRow>(db, sql, ...params)) {
    const list = out.get(r.game_id) ?? [];
    list.push(r);
    out.set(r.game_id, list);
  }
  return out;
}

/**
 * A stored price as the caller should see it right now. A sale whose end
 * time has passed is shown at the regular price even before the next
 * refresh confirms it.
 */
export function rowToPrice(r: PriceRow, now = Date.now()): ApiPrice {
  const ended = r.sale !== null && r.sale_ends_at !== null && Date.parse(r.sale_ends_at) <= now;
  const onSale = r.sale !== null && !ended;
  return {
    country: r.country,
    regular: { amount: r.regular, currency: r.currency },
    sale: onSale ? { amount: r.sale!, currency: r.currency } : undefined,
    discountPercent: onSale ? r.discount : 0,
    saleEndsAt: onSale ? (r.sale_ends_at ?? undefined) : undefined,
    checkedAt: r.checked_at,
  };
}

const same = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) < 0.005);

export interface PriceChange {
  gameId: string;
  country: string;
  before?: PriceRow;
  after?: PriceRow;
  newLow: boolean;
}

/**
 * Store a fresh observation. Only real changes write history, and the
 * returned change tells the alert planner what happened.
 */
export function applyPrice(db: Db, gameId: string, p: RegionPrice, now = Date.now()): PriceChange | undefined {
  const before = get<PriceRow>(db, 'SELECT * FROM prices WHERE game_id = ? AND country = ?', gameId, p.country);
  const sale = p.sale?.amount ?? null;
  const ends = p.saleEndsAt ?? null;
  const changed =
    !before ||
    before.currency !== p.regular.currency ||
    !same(before.regular, p.regular.amount) ||
    !same(before.sale, sale) ||
    (before.sale_ends_at ?? null) !== ends;

  if (!changed) {
    run(db, 'UPDATE prices SET checked_at = ? WHERE game_id = ? AND country = ?', now, gameId, p.country);
    return undefined;
  }

  const after: PriceRow = {
    game_id: gameId,
    country: p.country,
    currency: p.regular.currency,
    regular: p.regular.amount,
    sale,
    discount: p.discountPercent,
    sale_ends_at: ends,
    checked_at: now,
    changed_at: now,
  };
  run(
    db,
    `INSERT INTO prices (game_id, country, currency, regular, sale, discount, sale_ends_at, checked_at, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id, country) DO UPDATE SET currency = excluded.currency, regular = excluded.regular,
       sale = excluded.sale, discount = excluded.discount, sale_ends_at = excluded.sale_ends_at,
       checked_at = excluded.checked_at, changed_at = excluded.changed_at`,
    gameId,
    p.country,
    after.currency,
    after.regular,
    after.sale,
    after.discount,
    after.sale_ends_at,
    now,
    now,
  );

  const current = sale ?? p.regular.amount;
  // Read the lowest so far before this price joins the history
  const low = before && before.currency === after.currency ? lowSoFar(db, gameId, p.country, after.currency) : undefined;
  const newLow = low !== undefined && current < low - 0.005;
  const priceMoved = !before || before.currency !== after.currency || !same(before.sale ?? before.regular, current) || !same(before.regular, after.regular);
  if (priceMoved) {
    run(
      db,
      'INSERT OR REPLACE INTO price_history (game_id, country, t, currency, price, regular, discount) VALUES (?, ?, ?, ?, ?, ?, ?)',
      gameId,
      p.country,
      now,
      after.currency,
      current,
      after.regular,
      after.discount,
    );
  }

  return { gameId, country: p.country, before, after, newLow };
}

/** A history row with this discount marks "no longer sold here". */
export const DELISTED = -1;

export function removePrice(db: Db, gameId: string, country: string, now = Date.now()): PriceChange | undefined {
  const before = get<PriceRow>(db, 'SELECT * FROM prices WHERE game_id = ? AND country = ?', gameId, country);
  if (!before) return undefined;
  run(db, 'DELETE FROM prices WHERE game_id = ? AND country = ?', gameId, country);
  // Without this marker the history chart would keep treating the last price as available
  run(
    db,
    'INSERT OR REPLACE INTO price_history (game_id, country, t, currency, price, regular, discount) VALUES (?, ?, ?, ?, 0, 0, ?)',
    gameId,
    country,
    now,
    before.currency,
    DELISTED,
  );
  return { gameId, country, before, newLow: false };
}

/** Keep the denormalized sale flags on games in step with prices. */
export function refreshSaleFlags(db: Db, ids: string[], now = new Date()) {
  const nowIso = now.toISOString();
  // One transaction: a write each in its own commit is hundreds of disk flushes per chunk
  tx(db, () => ids.forEach((id) => saleFlagsFor(db, id, nowIso)));
}

function saleFlagsFor(db: Db, id: string, nowIso: string) {
  {
    const r = get<{ on_sale: number; max_discount: number | null; ends: string | null }>(
      db,
      // A sale counts only while it's live: no end date, or an end date still ahead
      `SELECT COUNT(*) > 0 AS on_sale, MAX(discount) AS max_discount, MIN(sale_ends_at) AS ends
       FROM prices WHERE game_id = ? AND sale IS NOT NULL AND (sale_ends_at IS NULL OR sale_ends_at > ?)`,
      id,
      nowIso,
    );
    const onSale = r?.on_sale ? 1 : 0;
    const max = r?.max_discount ?? 0;
    const ends = r?.ends ?? null;
    run(
      db,
      'UPDATE games SET on_sale = ?, max_discount = ?, sale_ends_at = ? WHERE id = ? AND (on_sale IS NOT ? OR max_discount IS NOT ? OR sale_ends_at IS NOT ?)',
      onSale,
      max,
      ends,
      id,
      onSale,
      max,
      ends,
    );
  }
}

/**
 * Lowest price seen in one country, in its current currency: only history since the
 * country last priced in another currency counts. Delisting markers don't count.
 */
function lowSoFar(db: Db, gameId: string, country: string, currency: string): number | undefined {
  const r = get<{ low: number | null }>(
    db,
    `SELECT MIN(price) AS low FROM price_history
     WHERE game_id = ? AND country = ? AND currency = ? AND discount >= 0
       AND t > COALESCE((SELECT MAX(t) FROM price_history WHERE game_id = ? AND country = ? AND currency <> ?), 0)`,
    gameId,
    country,
    currency,
    gameId,
    country,
    currency,
  );
  return r?.low ?? undefined;
}

/** Lowest price ever seen per country (and when), in that country's latest currency. */
export function lowsFor(db: Db, ids: string[]) {
  const out = new Map<string, { country: string; currency: string; price: number; at: number }[]>();
  if (!ids.length) return out;
  const lows = new Map<string, { gameId: string; country: string; currency: string; price: number; at: number }>();
  for (const r of all<{ game_id: string; country: string; t: number; currency: string; price: number }>(
    db,
    `SELECT game_id, country, t, currency, price FROM price_history
     WHERE game_id IN (${placeholders(ids.length)}) AND discount >= 0 ORDER BY game_id, country, t`,
    ...ids,
  )) {
    const k = `${r.game_id}|${r.country}`;
    const l = lows.get(k);
    // A new currency starts afresh; otherwise only a lower price counts, so the earliest of equal lows stays
    if (!l || l.currency !== r.currency || r.price < l.price - 0.005) lows.set(k, { gameId: r.game_id, country: r.country, currency: r.currency, price: r.price, at: r.t });
  }
  for (const l of lows.values()) {
    const list = out.get(l.gameId) ?? [];
    list.push({ country: l.country, currency: l.currency, price: l.price, at: l.at });
    out.set(l.gameId, list);
  }
  return out;
}

export function rowToGame(r: GameRow, nsuids?: Partial<Record<Group, string>>): ApiGame {
  return {
    key: r.id,
    platform: r.platform,
    title: r.title,
    image: r.image ?? undefined,
    publisher: r.publisher ?? undefined,
    releaseDate: r.release_date ?? undefined,
    productCode: r.product_code ?? undefined,
    applicationId: r.app_id ?? undefined,
    storeUrl: r.store_url ?? undefined,
    steamAppId: r.steam_app_id ?? undefined,
    nsuids,
    onSale: !!r.on_sale,
    maxDiscount: r.max_discount,
    saleEndsAt: r.sale_ends_at ?? undefined,
  };
}

/* ----------------------------- source health ---------------------------- */

export function sourceOk(db: Db, source: string, items: number, now = Date.now()) {
  run(
    db,
    `INSERT INTO source_status (source, last_ok, items) VALUES (?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET last_ok = excluded.last_ok, items = excluded.items`,
    source,
    now,
    items,
  );
}

export function sourceError(db: Db, source: string, error: unknown, now = Date.now()) {
  const msg = error instanceof Error ? error.message : String(error);
  run(
    db,
    `INSERT INTO source_status (source, last_error, last_error_at) VALUES (?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
    source,
    msg.slice(0, 300),
    now,
  );
}

/* -------------------------------- job runs -------------------------------- */

export function lastRun(db: Db, name: string): number | undefined {
  return get<{ last_ok: number }>(db, 'SELECT last_ok FROM job_runs WHERE name = ?', name)?.last_ok;
}

export function markRun(db: Db, name: string, now = Date.now()) {
  run(db, 'INSERT INTO job_runs (name, last_ok) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_ok = excluded.last_ok', name, now);
}

/** True when a job hasn't finished within its interval, including never. */
export function isOverdue(db: Db, name: string, every: number, now = Date.now()): boolean {
  const t = lastRun(db, name);
  return t === undefined || now - t >= every;
}

export { tx };
