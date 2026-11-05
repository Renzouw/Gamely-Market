import type { ApiFx } from '@shared/api';
import { HOME_CURRENCIES, STEAM_REGIONS, SWITCH_REGIONS } from '@shared/regions';
import { all, run, type Db } from '../db';
import { fetchFx } from '../sources/fx';
import { sourceError, sourceOk, tx } from '../store';

const WANTED = [...new Set([...HOME_CURRENCIES, ...SWITCH_REGIONS.map((r) => r.currency), ...STEAM_REGIONS.map((r) => r.currency)])];

export async function syncFx(db: Db): Promise<void> {
  try {
    const quotes = await fetchFx(WANTED);
    const now = Date.now();
    tx(db, () => {
      for (const q of quotes) {
        run(db, 'INSERT OR REPLACE INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES (?, ?, ?, ?, ?)', q.currency, q.perUsd, q.source, q.asOf, now);
      }
    });
    sourceOk(db, 'fx', quotes.length);
  } catch (e) {
    sourceError(db, 'fx', e);
  }
}

let cache: { at: number; fx: ApiFx } | undefined;

export function readFx(db: Db): ApiFx | undefined {
  if (cache && Date.now() - cache.at < 60_000) return cache.fx;
  const rows = all<{ currency: string; per_usd: number; source: 'ecb' | 'market'; as_of: string; fetched_at: number }>(db, 'SELECT * FROM fx');
  if (!rows.length) return undefined;
  const fx: ApiFx = {
    base: 'USD',
    rates: Object.fromEntries(rows.map((r) => [r.currency, r.per_usd])),
    sources: Object.fromEntries(rows.map((r) => [r.currency, r.source])),
    asOf: rows.find((r) => r.source === 'ecb')?.as_of ?? rows[0].as_of,
    updatedAt: Math.max(...rows.map((r) => r.fetched_at)),
  };
  cache = { at: Date.now(), fx };
  return fx;
}

export function invalidateFx() {
  cache = undefined;
}
