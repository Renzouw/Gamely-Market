import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { SWITCH_REGIONS } from '@shared/regions';
import { SCHEMA } from './schema';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // 64 MB page cache (the default is 2 MB for a database of well over 100 MB): directory and
  // deals queries run 4-5x faster. It lives outside the JavaScript heap and its cap.
  db.exec('PRAGMA cache_size = -65536;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add them to an old database. */
const COLUMNS: [table: string, column: string, ddl: string][] = [
  ['devices', 'event_alerts', "TEXT NOT NULL DEFAULT '{}'"],
  ['notifications', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['games', 'app_id', 'TEXT'], // Nintendo's application ID, the same in every region
  ['games', 'code_key', 'TEXT'], // product code key learned from another region, when Europe has none
  ['games', 'region_checked_at', 'INTEGER'], // last look for a Japan/Hong Kong/Korea match
];

/** Columns that are no longer used. */
const DROPPED: [table: string, column: string][] = [['games', 'jp_checked_at']];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS notifications_ticket ON notifications(ticket_id) WHERE ticket_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token ON devices(push_token) WHERE push_token IS NOT NULL',
];

/**
 * Tables first created with a hidden row ID, rebuilt keyed by their primary key alone
 * (WITHOUT ROWID). The old layout stored that key twice, once in the table and once in
 * a separate index: about 35 MB on a full database, and an extra write per change.
 */
const COMPACT = ['prices', 'price_history'];

/** No longer used: lowest prices are worked out from price_history (store.ts lowsFor). */
const DROPPED_TABLES = ['lows'];

function rebuildCompact(db: DatabaseSync): boolean {
  let rebuilt = false;
  for (const table of COMPACT) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
    if (!row || /WITHOUT ROWID/i.test(row.sql)) continue;
    const ddl = SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) WITHOUT ROWID;`))?.[0];
    if (!ddl) throw new Error(`No compact layout for ${table}`);
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).join(', ');
    db.exec(`DROP TABLE IF EXISTS ${table}_compact`);
    // Foreign keys can't be switched inside a transaction, and every row was checked when first written
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(db, () => {
        db.exec(ddl.replace(`IF NOT EXISTS ${table} `, `${table}_compact `));
        db.exec(`INSERT INTO ${table}_compact (${cols}) SELECT ${cols} FROM ${table}`);
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${table}_compact RENAME TO ${table}`);
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    rebuilt = true;
  }
  return rebuilt;
}

/**
 * Europe used to list some Switch 2 Editions with the upgrade pack's ID first, and it was
 * taken for the game's own: those games showed the upgrade's price in Europe's countries.
 * Unhook those IDs from games that aren't the upgrade pack itself, and forget the prices
 * and history they produced there (the next refresh prices the game properly).
 */
function dropMisfiledUpgradeIds(db: DatabaseSync) {
  const rows = db.prepare("SELECT game_id, nsuid FROM game_ids WHERE grp = 'europe' AND nsuid LIKE '7005%' AND game_id NOT LIKE 'sw:eu:7005%'").all() as { game_id: string; nsuid: string }[];
  if (!rows.length) return;
  const europe = SWITCH_REGIONS.filter((r) => r.group === 'europe').map((r) => r.code);
  const marks = europe.map(() => '?').join(',');
  tx(db, () => {
    for (const r of rows) {
      db.prepare("DELETE FROM game_ids WHERE grp = 'europe' AND nsuid = ?").run(r.nsuid);
      db.prepare(`DELETE FROM prices WHERE game_id = ? AND country IN (${marks})`).run(r.game_id, ...europe);
      db.prepare(`DELETE FROM price_history WHERE game_id = ? AND country IN (${marks})`).run(r.game_id, ...europe);
    }
  });
}

function migrate(db: DatabaseSync) {
  dropMisfiledUpgradeIds(db);
  let shrink = rebuildCompact(db);
  for (const table of DROPPED_TABLES) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      db.exec(`DROP TABLE ${table}`);
      shrink = true;
    }
  }
  // Hand the freed space back to the disk (once, right after the change above)
  if (shrink) db.exec('VACUUM');

  for (const [table, column, ddl] of COLUMNS) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
  for (const [table, column] of DROPPED) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (cols.includes(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (has('devices', 'push_token')) {
    // A reinstall used to leave the same push token on an old device row. Keep only
    // the newest owner before the unique index goes on.
    db.exec(`UPDATE devices SET push_token = NULL WHERE push_token IS NOT NULL AND rowid NOT IN
               (SELECT MAX(rowid) FROM devices WHERE push_token IS NOT NULL GROUP BY push_token)`);
  }
  for (const sql of INDEXES) {
    const [, table, column] = sql.match(/ON (\w+)\((\w+)\)/) ?? [];
    if (!table || has(table, column)) db.exec(sql);
  }
}

/** Run fn inside a transaction. node:sqlite has no helper for this. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Prepared statements, reused: a price sweep runs the same few statements
 * hundreds of thousands of times, and preparing one each time is real work on
 * the event loop. Bounded, because IN (?, ?, ...) lists make many variants.
 */
const statements = new WeakMap<Db, Map<string, StatementSync>>();
function prepared(db: Db, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  let s = cache.get(sql);
  if (!s) {
    if (cache.size >= 500) cache.clear();
    cache.set(sql, (s = db.prepare(sql)));
  }
  return s;
}

export function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return prepared(db, sql).all(...params) as T[];
}

export function get<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return prepared(db, sql).get(...params) as T | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]) {
  return prepared(db, sql).run(...params);
}

/** "?, ?, ?" for an IN (...) list */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');
