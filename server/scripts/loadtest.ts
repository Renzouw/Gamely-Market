/**
 * Load check at realistic scale, entirely in memory (no network):
 *   npx tsx scripts/loadtest.ts
 * 15,000 games x 18 countries, 3,000 devices watching 20 games each, then a
 * store-wide sale that changes 3,000 games at once.
 */
import { SWITCH_REGIONS } from '@shared/regions';
import { queueAlertsForChanges } from '../src/alerts/run';
import { bumpVersion, listDeals, searchGames } from '../src/api/listings';
import { all, openDb, run, tx } from '../src/db';
import { applyPrice, refreshSaleFlags, type PriceChange } from '../src/store';

const RATES: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.8, CHF: 0.88, NOK: 10.6, SEK: 10.4, DKK: 6.9, PLN: 3.9, CZK: 22.8, ZAR: 18, AUD: 1.52, NZD: 1.66, JPY: 152 };
const db = openDb(':memory:');
const N = 15000;
const now = Date.now();
const countries = SWITCH_REGIONS.filter((r) => r.group !== 'americas');
const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now();
  const out = fn();
  console.log(`${label.padEnd(34)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`);
  return out;
};
// Regional prices that look like the real thing: same USD price, local currency, small regional spread
const local = (usd: number, cur: string, i: number) => Math.round(usd * RATES[cur] * (0.85 + ((i * 7) % 30) / 100) * 100) / 100;

time(`seed ${N} games x ${countries.length} countries`, () =>
  tx(db, () => {
    for (const [cur, rate] of Object.entries(RATES)) run(db, 'INSERT INTO fx VALUES (?, ?, ?, ?, ?)', cur, rate, 'ecb', 'x', now);
    for (let i = 0; i < N; i++) {
      const id = `sw:eu:${i}`;
      run(db, 'INSERT INTO games (id, platform, title, title_key, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, i % 5 ? 'switch' : 'switch2', `Game ${i}`, `game ${i}`, i, now, now);
      const usd = 10 + (i % 60);
      countries.forEach((c, ci) => {
        const onSale = i % 4 === 0;
        const reg = local(usd, c.currency, i + ci);
        applyPrice(db, id, { country: c.code, regular: { amount: reg, currency: c.currency }, sale: onSale ? { amount: Math.round(reg * 60) / 100, currency: c.currency } : undefined, discountPercent: onSale ? 40 : 0, saleEndsAt: onSale ? new Date(now + 86400000).toISOString() : undefined }, now);
      });
    }
  }),
);
time('refresh sale flags (all games)', () => refreshSaleFlags(db, all<{ id: string }>(db, 'SELECT id FROM games').map((r) => r.id)));
tx(db, () => {
  for (let d = 0; d < 3000; d++) {
    run(db, "INSERT INTO devices (id, secret_hash, home_region, currency, switch_regions, steam_regions, alerts_enabled, created_at, last_seen) VALUES (?, 'x', 'GB', 'USD', ?, '[]', 1, 0, 0)", `d${d}`, JSON.stringify(countries.map((c) => c.code)));
    for (let w = 0; w < 20; w++) run(db, "INSERT OR IGNORE INTO watches (device_id, game_id, alerts, created_at) VALUES (?, ?, '{}', 0)", `d${d}`, `sw:eu:${(d * 7 + w * 13) % N}`);
  }
});

const fx = { base: 'USD', rates: RATES, updatedAt: now };
const q = { platform: 'switch' as const, sort: 'popular' as const, home: 'GB', currency: 'USD', regions: countries.map((c) => c.code) };
bumpVersion();
const first = time('deals, first request (ranks)', () => listDeals(db, q, fx));
time('deals, repeat request (cached)', () => listDeals(db, q, fx));
time('deals, page 5 (cached)', () => listDeals(db, { ...q, cursor: '120' }, fx));
time('deals, cheapest + filter (ranks)', () => listDeals(db, { ...q, sort: 'cheapest', minDiscount: 30 }, fx));
console.log(`  ${first.total} games on sale`);
time('directory search', () => searchGames(db, { platform: 'all-switch', key: 'game 12', regions: q.regions }));
time('directory deep page', () => searchGames(db, { platform: 'all-switch', key: '', regions: q.regions, cursor: '9000' }));

const changes: PriceChange[] = [];
time('big sale: apply 3,000 games x 3', () =>
  tx(db, () => {
    for (let i = 1; i < 12000; i += 4) {
      for (const c of countries.slice(0, 3)) {
        const reg = local(10 + (i % 60), c.currency, i);
        const ch = applyPrice(db, `sw:eu:${i}`, { country: c.code, regular: { amount: reg, currency: c.currency }, sale: { amount: Math.round(reg * 25) / 100, currency: c.currency }, discountPercent: 75, saleEndsAt: new Date(now + 3 * 86400000).toISOString() }, now + 1000);
        if (ch) changes.push(ch);
      }
    }
  }),
);
const queued = time('plan alerts for every watcher', () => queueAlertsForChanges(db, changes, now + 2000));
console.log(`  ${changes.length} price changes, ${queued} alerts queued`);
