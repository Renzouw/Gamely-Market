import { config } from './config';
import { all, get, run, type Db } from './db';
import { queueEndingAlerts, refreshAndAlert } from './alerts/run';
import { discoverSteamDeals, syncEuCatalog, syncUsDeals, syncUsFullCatalog } from './ingest/catalog';
import { invalidateFx, syncFx } from './ingest/fx';
import { addSeaOnlyGames, linkByCode, linkRegions, linkSeaByTitle, linkUpgradePacks, syncRegionCatalogs, syncRegionSales } from './ingest/regions';
import { isOverdue, markRun } from './store';
import { checkReceipts, dispatch } from './push/dispatch';
import { detectSaleEvents, queueBigDeals } from './events/run';
import { chunk } from './sources/http';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Keep the tables that grow forever in check. Alerts older than 60 days aren't shown anywhere. */
/** JavaScript memory in use, logged after each job so a slow climb toward the cap shows early */
const heapMb = () => Math.round(process.memoryUsage().heapUsed / 1048576);

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
  // Rebuilding the deals index takes a few hundred ms and lots of memory, so a long job
  // refreshes it at most once a minute, and once more at the end
  let lastBump = 0;
  const pricesChanged = (force = false) => {
    if (!force && Date.now() - lastBump < 60_000) return false;
    lastBump = Date.now();
    onPricesChanged();
    return true;
  };
  const refresh = async (ids: string[], size = 300) => {
    let pending = false;
    for (const part of chunk(ids, size)) {
      const { changes, queued } = await refreshAndAlert(db, part);
      if (!changes.length) continue;
      pending = !pricesChanged();
      log(`prices: ${changes.length} changes, ${queued} alerts queued`);
    }
    if (pending) pricesChanged(true);
  };

  /**
   * Watched games, and sales whose end time has just passed (to see whether
   * they really ended or were extended). Running sales don't need checking
   * this often: reads already hide a sale once its end time passes.
   */
  async function hot() {
    const soon = new Date(Date.now() + 15 * 60_000).toISOString();
    const ids = all<{ id: string }>(
      db,
      `SELECT DISTINCT game_id AS id FROM watches
       UNION SELECT id FROM games WHERE on_sale = 1 AND sale_ends_at IS NOT NULL AND sale_ends_at <= ?`,
      soon,
    ).map((r) => r.id);
    await refresh(ids);
  }

  /**
   * New sales: Nintendo's catalogs flag discounted games (Europe, the Americas,
   * Southeast Asia, Japan), Steam lists its specials.
   */
  async function deals() {
    const found = new Set<string>();
    for (const platform of ['switch2', 'switch'] as const) {
      (await syncEuCatalog(db, { platform, onSaleOnly: true, maxPages: 60 })).forEach((id) => found.add(id));
      (await syncUsDeals(db, platform)).forEach((id) => found.add(id));
    }
    (await discoverSteamDeals(db)).forEach((id) => found.add(id));
    // Only re-price what we haven't already got a sale price for
    const fresh = [...found].filter((id) => !get<{ n: number }>(db, 'SELECT 1 AS n FROM games WHERE id = ? AND on_sale = 1', id));
    // A sale in Southeast Asia or Japan alone: the game may already be on sale elsewhere,
    // so look at that region's own prices
    for (const { countries, ids } of await syncRegionSales(db)) {
      const there = `SELECT 1 AS n FROM prices WHERE game_id = ? AND sale IS NOT NULL AND country IN (${countries.map(() => '?').join(', ')})`;
      for (const id of ids) if (!get<{ n: number }>(db, there, id, ...countries)) fresh.push(id);
    }
    await refresh([...new Set(fresh)]);
    // Fresh store-wide counts and fresh prices: check for a big sale now, so its "top picks" are current
    detectSaleEvents(db);
  }

  /** Everything currently discounted, so ended sales drop off promptly. */
  async function sales() {
    await refresh(all<{ id: string }>(db, 'SELECT id FROM games WHERE on_sale = 1').map((r) => r.id));
  }

  /** A source that failed since t0 and hasn't succeeded since. Sync functions catch their own errors, so this is how a job learns of them. */
  const failedSince = (source: string, t0: number) => {
    const r = get<{ last_ok: number | null; last_error_at: number | null }>(db, 'SELECT last_ok, last_error_at FROM source_status WHERE source = ?', source);
    return !!r && (r.last_error_at ?? 0) >= t0 && (r.last_ok ?? 0) < t0;
  };

  /** Full catalogs, then Japan, Hong Kong and Korea, then price whatever got newly linked. */
  async function catalog(): Promise<boolean> {
    const t0 = Date.now();
    for (const platform of ['switch2', 'switch'] as const) await syncEuCatalog(db, { platform, onSaleOnly: false });
    await syncUsFullCatalog(db);
    // Games linked to the Americas that have never had an Americas price: price them now, not at
    // the next daily sweep. Any price history there means they were priced (or are not sold there).
    const usUnpriced = all<{ id: string }>(
      db,
      `SELECT DISTINCT i.game_id AS id FROM game_ids i WHERE i.grp = 'americas'
         AND NOT EXISTS (SELECT 1 FROM price_history h WHERE h.game_id = i.game_id AND h.country IN ('US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE'))`,
    ).map((r) => r.id);
    await syncRegionCatalogs(db);
    const byTitle = linkSeaByTitle(db);
    const linked = [...byTitle, ...(await linkRegions(db))];
    for (const grp of ['japan', 'hongkong', 'korea', 'sea'] as const) linked.push(...linkByCode(db, grp));
    // Last, once every way of matching has had its turn
    const seaOnly = addSeaOnlyGames(db);
    linked.push(...seaOnly);
    if (byTitle.length || seaOnly.length) log(`regions: ${byTitle.length} games found in Southeast Asia by title, ${seaOnly.length} sold only there`);
    log(`regions: ${linked.length} games newly linked in Japan, Hong Kong, Korea or Southeast Asia`);
    // Upgrade packs filed for the first time have no price yet; nor do ones just found in Southeast Asia
    const packs = all<{ id: string }>(db, "SELECT pack_id AS id FROM upgrades u WHERE NOT EXISTS (SELECT 1 FROM price_history h WHERE h.game_id = u.pack_id)").map((r) => r.id);
    const seaPacks = await linkUpgradePacks(db);
    if (seaPacks.length) log(`upgrade packs: ${seaPacks.length} found in Japan or Southeast Asia`);
    await refresh([...new Set([...usUnpriced, ...linked, ...packs, ...seaPacks])]);
    return !failedSince('nintendo-eu-catalog', t0);
  }

  /** Every game in every region, once a day. Catches sales the catalogs haven't flagged yet. */
  async function sweep(): Promise<boolean> {
    const t0 = Date.now();
    await refresh(all<{ id: string }>(db, 'SELECT id FROM games ORDER BY on_sale DESC, COALESCE(rank, 1e9)').map((r) => r.id), 200);
    return !failedSince('nintendo-prices', t0);
  }

  const isEmpty = () => !get<{ n: number }>(db, 'SELECT 1 AS n FROM games LIMIT 1');
  /**
   * Daily jobs remember when they last finished. The PC restarts more often
   * than once a day, and a timer alone would start counting from zero each
   * time, so these would never run. A run the stores made fail isn't counted,
   * so it's tried again at the next start.
   */
  const remembered = (name: string, every: number, fn: () => Promise<boolean | void>) => ({
    name,
    every,
    atStart: isEmpty() || isOverdue(db, name, every),
    run: async () => {
      if ((await fn()) !== false) markRun(db, name);
    },
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
    remembered('prune', 24 * 3600_000, async () => prune(db)),
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
        if (job.name !== 'dispatch') log(`job ${job.name} done in ${Date.now() - t0}ms · ${heapMb()} MB in use`);
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
        log(`job ${job.name} done (startup) · ${heapMb()} MB in use`);
      } catch (e) {
        log(`job ${job.name} failed at startup:`, e instanceof Error ? e.message : e);
      } finally {
        running.delete(job.name);
      }
    }
  })();
  return () => timers.forEach(clearInterval);
}
