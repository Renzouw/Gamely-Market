import { config } from './config';
import { all, get, run, type Db } from './db';
import { queueEndingAlerts, refreshAndAlert } from './alerts/run';
import { discoverSteamDeals, syncEuCatalog, syncUsCatalog, syncUsFullCatalog } from './ingest/catalog';
import { invalidateFx, syncFx } from './ingest/fx';
import { linkRegions, syncRegionCatalogs } from './ingest/regions';
import { isOverdue, markRun } from './store';
import { checkReceipts, dispatch } from './push/dispatch';
import { detectSaleEvents, queueBigDeals } from './events/run';
import { chunk } from './sources/http';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Keep the tables that grow forever in check. Alerts older than 60 days aren't shown anywhere. */
export function prune(db: Db, now = Date.now()) {
  const cutoff = now - 60 * 24 * 3600_000;
  run(db, 'DELETE FROM notifications WHERE created_at < ?', cutoff);
  run(db, 'DELETE FROM deal_seen WHERE at < ?', cutoff);
  run(db, 'DELETE FROM sale_counts WHERE t < ?', now - 30 * 24 * 3600_000);
}

export function createJobs(db: Db, onPricesChanged: () => void) {
  /**
   * Re-price in chunks. Each chunk holds the price lock only briefly, so the
   * 10-minute watched-games refresh never waits long behind the daily sweep.
   */
  const refresh = async (ids: string[], size = 300) => {
    for (const part of chunk(ids, size)) {
      const { changes, queued } = await refreshAndAlert(db, part);
      if (!changes.length) continue;
      onPricesChanged();
      log(`prices: ${changes.length} changes, ${queued} alerts queued`);
    }
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
    await refresh(ids);
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
    await refresh(fresh);
    // Fresh store-wide counts and fresh prices: check for a big sale now, so its "top picks" are current
    detectSaleEvents(db);
  }

  /** Everything currently discounted, so ended sales drop off promptly. */
  async function sales() {
    await refresh(all<{ id: string }>(db, 'SELECT id FROM games WHERE on_sale = 1').map((r) => r.id));
  }

  /** Full catalogs, then Japan, Hong Kong and Korea, then price whatever got newly linked. */
  async function catalog() {
    for (const platform of ['switch2', 'switch'] as const) await syncEuCatalog(db, { platform, onSaleOnly: false });
    await syncUsFullCatalog(db);
    await syncRegionCatalogs(db);
    const linked = await linkRegions(db);
    log(`regions: ${linked.length} games newly linked in Japan, Hong Kong or Korea`);
    await refresh(linked);
  }

  /** Every game in every region, once a day. Catches sales the catalogs haven't flagged yet. */
  async function sweep() {
    await refresh(all<{ id: string }>(db, 'SELECT id FROM games ORDER BY on_sale DESC, COALESCE(rank, 1e9)').map((r) => r.id), 200);
  }

  const isEmpty = () => !get<{ n: number }>(db, 'SELECT 1 AS n FROM games LIMIT 1');
  /**
   * Daily jobs remember when they last finished. The PC restarts more often
   * than once a day, and a timer alone would start counting from zero each
   * time, so these would never run.
   */
  const remembered = (name: string, every: number, fn: () => Promise<void>) => ({
    name,
    every,
    atStart: isEmpty() || isOverdue(db, name, every),
    run: async () => (await fn(), markRun(db, name)),
  });

  return [
    { name: 'fx', every: config.schedule.fx, atStart: true, run: async () => (await syncFx(db), invalidateFx()) },
    { name: 'deals', every: config.schedule.dealDiscovery, atStart: true, run: deals },
    remembered('catalog', config.schedule.catalog, catalog),
    { name: 'hot', every: config.schedule.hotPrices, atStart: false, run: hot },
    { name: 'sales', every: config.schedule.salePrices, atStart: false, run: sales },
    remembered('sweep', config.schedule.fullSweep, sweep),
    { name: 'events', every: config.schedule.saleEvents, atStart: false, run: async () => void detectSaleEvents(db) },
    { name: 'big-deals', every: config.schedule.bigDeals, atStart: false, run: async () => void queueBigDeals(db) },
    { name: 'ending', every: config.schedule.endingSoon, atStart: false, run: async () => void queueEndingAlerts(db) },
    { name: 'dispatch', every: config.schedule.dispatch, atStart: false, run: async () => void (await dispatch(db)) },
    { name: 'prune', every: 24 * 3600_000, atStart: false, run: async () => void prune(db) },
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
