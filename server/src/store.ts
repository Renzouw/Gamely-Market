import { titleKey } from '@shared/match';
import type { ApiGame, ApiPrice } from '@shared/api';
import type { Platform, RegionPrice } from '@shared/types';
import { all, get, placeholders, run, tx, type Db } from './db';

export type Group = 'americas' | 'europe' | 'japan';

export interface GameRow {
  id: string;
  platform: Platform;
  title: string;
  title_key: string;
  image: string | null;
  publisher: string | null;
  release_date: string | null;
  product_code: string | null;
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
  storeUrl?: string;
  steamAppId?: number;
  rank?: number;
}

/* ------------------------------- games -------------------------------- */

export function upsertGame(db: Db, g: GameInput, now = Date.now()) {
  run(
    db,
    `INSERT INTO games (id, platform, title, title_key, image, publisher, release_date, product_code, store_url, steam_app_id, rank, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, title_key = excluded.title_key,
       image = COALESCE(excluded.image, games.image),
       publisher = COALESCE(excluded.publisher, games.publisher),
       release_date = COALESCE(excluded.release_date, games.release_date),
       product_code = COALESCE(excluded.product_code, games.product_code),
       store_url = COALESCE(games.store_url, excluded.store_url),
       rank = COALESCE(excluded.rank, games.rank),
       updated_at = excluded.updated_at`,
    g.id,
    g.platform,
    g.title,
    titleKey(g.title),
    g.image ?? null,
    g.publisher ?? null,
    g.releaseDate ?? null,
    g.productCode ?? null,
    g.storeUrl ?? null,
    g.steamAppId ?? null,
    g.rank ?? null,
    now,
    now,
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
     WHERE g.platform = ? AND g.title_key = ?
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

  const low = get<{ price: number; currency: string }>(db, 'SELECT price, currency FROM lows WHERE game_id = ? AND country = ?', gameId, p.country);
  let newLow = false;
  if (!low || low.currency !== after.currency) {
    run(db, 'INSERT OR REPLACE INTO lows (game_id, country, currency, price, at) VALUES (?, ?, ?, ?, ?)', gameId, p.country, after.currency, current, now);
  } else if (current < low.price - 0.005) {
    run(db, 'UPDATE lows SET price = ?, at = ? WHERE game_id = ? AND country = ?', current, now, gameId, p.country);
    newLow = true;
  }

  return { gameId, country: p.country, before, after, newLow };
}

export function removePrice(db: Db, gameId: string, country: string): PriceChange | undefined {
  const before = get<PriceRow>(db, 'SELECT * FROM prices WHERE game_id = ? AND country = ?', gameId, country);
  if (!before) return undefined;
  run(db, 'DELETE FROM prices WHERE game_id = ? AND country = ?', gameId, country);
  return { gameId, country, before, newLow: false };
}

/** Keep the denormalized sale flags on games in step with prices. */
export function refreshSaleFlags(db: Db, ids: string[], now = new Date()) {
  const nowIso = now.toISOString();
  for (const id of ids) {
    const r = get<{ on_sale: number; max_discount: number | null; ends: string | null }>(
      db,
      `SELECT COUNT(sale) > 0 AS on_sale, MAX(discount) AS max_discount,
              MIN(CASE WHEN sale IS NOT NULL AND sale_ends_at > ? THEN sale_ends_at END) AS ends
       FROM prices WHERE game_id = ?`,
      nowIso,
      id,
    );
    run(db, 'UPDATE games SET on_sale = ?, max_discount = ?, sale_ends_at = ? WHERE id = ?', r?.on_sale ? 1 : 0, r?.max_discount ?? 0, r?.ends ?? null, id);
  }
}

export function lowsFor(db: Db, ids: string[]) {
  const out = new Map<string, { country: string; currency: string; price: number; at: number }[]>();
  if (!ids.length) return out;
  for (const r of all<{ game_id: string; country: string; currency: string; price: number; at: number }>(
    db,
    `SELECT * FROM lows WHERE game_id IN (${placeholders(ids.length)})`,
    ...ids,
  )) {
    const list = out.get(r.game_id) ?? [];
    list.push({ country: r.country, currency: r.currency, price: r.price, at: r.at });
    out.set(r.game_id, list);
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

export { tx };
