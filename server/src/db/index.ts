import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SCHEMA } from './schema';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add them to an old database. */
const COLUMNS: [table: string, column: string, ddl: string][] = [
  ['devices', 'event_alerts', "TEXT NOT NULL DEFAULT '{}'"],
  ['notifications', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['games', 'jp_checked_at', 'INTEGER'],
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS notifications_ticket ON notifications(ticket_id) WHERE ticket_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token ON devices(push_token) WHERE push_token IS NOT NULL',
];

function migrate(db: DatabaseSync) {
  for (const [table, column, ddl] of COLUMNS) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
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

export function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

/** "?, ?, ?" for an IN (...) list */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');
