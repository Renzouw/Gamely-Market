import { config } from './config';
import { all, get, type Db } from './db';
import { queueAlertsForChanges, queueEndingAlerts } from './alerts/run';
import { discoverSteamDeals, matchJapan, syncEuCatalog, syncUsCatalog } from './ingest/catalog';
import { invalidateFx, syncFx } from './ingest/fx';
import { refreshGames } from './ingest/prices';
import { checkReceipts, dispatch } from './push/dispatch';
import { chunk } from './sources/http';
import type { PriceChange } from './store';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export function createJobs(db: Db, onPricesChanged: () => void) {
  const afterRefresh = (changes: PriceChange[]) => {
    if (!changes.length) return;
    const queued = queueAlertsForChanges(db, changes);
    onPricesChanged();
    log(`prices: ${changes.length} changes, ${queued} alerts queued`);
  };

  /** Watched games and sales about to start or end: checked most often. */
  async function hot() {
    const soon = new Date(Date.now() + 48 * 3600_000).toISOString();
    const ids = all<{ id: string }>(
      db,
      `SELECT DISTINCT game_id AS id FROM watches
       UNION SELECT id FROM games WHERE on_sale = 1 AND sale_ends_at IS NOT NULL AND sale_ends_at <= ?`,
      soon,
    ).map((r) => r.id);
    for (const part of chunk(ids, 500)) afterRefresh(await refreshGames(db, part));
  }

  /** New sales: Nintendo's catalogs flag discounted games, Steam lists its specials. */
  async function deals() {
    const found = new Set<string>();
    for (const platform of ['switch2', 'switch'] as const) {
      (await syncEuCatalog(db, { platform, onSaleOnly: true, maxPages: 60 })).forEach((id) => found.add(id));
      (await syncUsCatalog(db, { platform, onSaleOnly: true, maxPages: 60 })).forEach((id) => found.add(id));
    }
    (await discoverSteamDeals(db)).forEach((id) => found.add(id));
    // Only re-price what we haven't already got a sale price for
    const fresh = [...found].filter((id) => !get<{ n: number }>(db, 'SELECT 1 AS n FROM games WHERE id = ? AND on_sale = 1', id));
    for (const part of chunk(fresh, 500)) afterRefresh(await refreshGames(db, part));
  }

  /** Everything currently discounted, so ended sales drop off promptly. */
  async function sales() {
    const ids = all<{ id: string }>(db, 'SELECT id FROM games WHERE on_sale = 1').map((r) => r.id);
    for (const part of chunk(ids, 500)) afterRefresh(await refreshGames(db, part));
  }

  async function catalog() {
    for (const platform of ['switch2', 'switch'] as const) {
      await syncEuCatalog(db, { platform, onSaleOnly: false });
      await syncUsCatalog(db, { platform, onSaleOnly: false });
    }
    await matchJapan(db);
  }

  /** Every game in every region, once a day. Catches sales the catalogs haven't flagged yet. */
  async function sweep() {
    const ids = all<{ id: string }>(db, 'SELECT id FROM games ORDER BY on_sale DESC, COALESCE(rank, 1e9)').map((r) => r.id);
    for (const part of chunk(ids, 500)) afterRefresh(await refreshGames(db, part));
  }

  const isEmpty = () => !get<{ n: number }>(db, 'SELECT 1 AS n FROM games LIMIT 1');

  return [
    { name: 'fx', every: config.schedule.fx, atStart: true, run: async () => (await syncFx(db), invalidateFx()) },
    { name: 'catalog', every: config.schedule.catalog, atStart: isEmpty(), run: catalog },
    { name: 'deals', every: config.schedule.dealDiscovery, atStart: true, run: deals },
    { name: 'hot', every: config.schedule.hotPrices, atStart: false, run: hot },
    { name: 'sales', every: config.schedule.salePrices, atStart: false, run: sales },
    { name: 'sweep', every: config.schedule.fullSweep, atStart: false, run: sweep },
    { name: 'ending', every: config.schedule.endingSoon, atStart: false, run: async () => void queueEndingAlerts(db) },
    { name: 'dispatch', every: config.schedule.dispatch, atStart: false, run: async () => void (await dispatch(db)) },
    { name: 'receipts', every: config.schedule.receipts, atStart: false, run: () => checkReceipts(db) },
  ];
}

/**
 * Minimal scheduler: each job runs on its own timer, never overlaps with
 * itself, and gets a little jitter so jobs don't all fire together.
 */
export function startScheduler(jobs: ReturnType<typeof createJobs>) {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();
  for (const job of jobs) {
    const tick = async () => {
      if (running.has(job.name)) return;
      running.add(job.name);
      const t0 = Date.now();
      try {
        await job.run();
        if (job.name !== 'dispatch') log(`job ${job.name} done in ${Date.now() - t0}ms`);
      } catch (e) {
        log(`job ${job.name} failed:`, e instanceof Error ? e.message : e);
      } finally {
        running.delete(job.name);
      }
    };
    const jitter = Math.floor(Math.random() * Math.min(30_000, job.every / 10));
    timers.push(setInterval(tick, job.every + jitter));
  }
  // Startup work runs right away and in order: exchange rates first, so the
  // very first prices served can already be converted.
  void (async () => {
    for (const job of jobs.filter((j) => j.atStart)) {
      if (running.has(job.name)) continue;
      running.add(job.name);
      try {
        await job.run();
        log(`job ${job.name} done (startup)`);
      } catch (e) {
        log(`job ${job.name} failed at startup:`, e instanceof Error ? e.message : e);
      } finally {
        running.delete(job.name);
      }
    }
  })();
  return () => timers.forEach(clearInterval);
}
