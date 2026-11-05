import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_EVENT_ALERTS } from '@shared/api';
import { composeDeals, composeEvent, evaluate, pickBigDeals, type DealCandidate } from '../src/events/detect';
import { detectSaleEvents, queueBigDeals, recordSaleCount } from '../src/events/run';
import { all, openDb, run, type Db } from '../src/db';
import { createApp } from '../src/api/app';
import type { PriceRow } from '../src/store';

const HOUR = 3600_000;
const now = Date.parse('2026-11-20T18:00:00Z');
const week = (count: number) => Array.from({ length: 7 * 24 }, (_, i) => ({ t: now - (8 * 24 - i) * HOUR, count: count + ((i * 37) % 200) }));

describe('store-wide sale detection', () => {
  it('needs a week of normal days before it will call anything a sale', () => {
    expect(evaluate({ platform: 'steam', current: 40000, history: [], now }).action).toBe('none');
  });

  it('starts an event when the count jumps well above normal', () => {
    const d = evaluate({ platform: 'steam', current: 38000, history: week(9000), now });
    expect(d.action).toBe('start');
    expect(d.action === 'start' && d.baseline).toBeGreaterThan(9000);
  });

  it('ignores ordinary ups and downs', () => {
    expect(evaluate({ platform: 'steam', current: 11000, history: week(9000), now }).action).toBe('none');
  });

  it('needs a real jump, not just a ratio, on small catalogs', () => {
    // Switch 2 going from 20 to 40 discounted games is 2x but only 20 games
    expect(evaluate({ platform: 'switch2', current: 40, history: week(20).map((h) => ({ ...h, count: 20 })), now }).action).toBe('none');
  });

  it('ends when the count falls back near normal, using the baseline frozen at the start', () => {
    expect(evaluate({ platform: 'steam', current: 20000, history: [], active: { baseline: 9000 }, now }).action).toBe('update');
    expect(evaluate({ platform: 'steam', current: 10000, history: [], active: { baseline: 9000 }, now }).action).toBe('end');
  });
});

const price = (country: string, currency: string, regular: number, sale: number | null): PriceRow => ({
  game_id: 'x', country, currency, regular, sale, discount: sale ? Math.round((1 - sale / regular) * 100) : 0, sale_ends_at: '2026-11-27T00:00:00Z', checked_at: now, changed_at: now,
});
const fx = { base: 'USD', rates: { USD: 1, GBP: 0.8, EUR: 0.9 }, updatedAt: 0 };
const device = { id: 'd', currency: 'USD', homeRegion: 'US', switchRegions: ['GB', 'DE'], steamRegions: ['US'] };
const cand = (gameId: string, rank: number, platform: DealCandidate['platform'], prices: PriceRow[]): DealCandidate => ({ gameId, title: gameId, rank, platform, prices });

describe('big deals', () => {
  const candidates = [
    cand('Hades', 9, 'steam', [price('US', 'USD', 25, 10)]),
    cand('Elden Ring', 2, 'steam', [price('US', 'USD', 60, 24)]),
    cand('Small Cut', 1, 'steam', [price('US', 'USD', 60, 45)]),
    cand('Elsewhere', 3, 'steam', [price('AR', 'USD', 60, 10)]),
    cand('Zelda', 4, 'switch', [price('GB', 'GBP', 50, 20)]),
  ];

  it('picks deep discounts in your own regions, most popular first', () => {
    const picks = pickBigDeals({ device, prefs: DEFAULT_EVENT_ALERTS, candidates, watched: new Set(), seen: new Set(), fx, now });
    expect(picks.map((p) => p.gameId)).toEqual(['Elden Ring', 'Zelda', 'Hades']);
    expect(picks[1].price).toBeCloseTo(25);
  });

  it('skips watched games, games already sent for this sale, and platforms you turned off', () => {
    const picks = pickBigDeals({
      device,
      prefs: { ...DEFAULT_EVENT_ALERTS, platforms: ['steam'] },
      candidates,
      watched: new Set(['Elden Ring']),
      seen: new Set(['Hades|2026-11-27T00:00:00Z']),
      fx,
      now,
    });
    expect(picks).toEqual([]);
  });

  it('writes a single deal and a digest differently', () => {
    const picks = pickBigDeals({ device, prefs: DEFAULT_EVENT_ALERTS, candidates, watched: new Set(), seen: new Set(), fx, now });
    expect(composeDeals(picks.slice(0, 1), 'USD').title).toBe('Elden Ring is 60% off');
    const digest = composeDeals(picks, 'USD');
    expect(digest.title).toBe('3 big deals on popular games');
    expect(digest.body).toBe('Elden Ring −60% ($24.00), Zelda −60% ($25.00), Hades −60% ($10.00).');
  });

  it('describes a store-wide sale and merges the two Nintendo platforms', () => {
    expect(composeEvent([{ platform: 'steam', count: 38000, baseline: 9100 }], []).body).toBe('38,000 games discounted, about 4× a normal day.');
    const n = composeEvent([{ platform: 'switch', count: 5000, baseline: 2500 }, { platform: 'switch2', count: 200, baseline: 60 }], []);
    expect(n.title).toBe('A big eShop sale is on');
    expect(n.body).toContain('5,200 games discounted');
  });
});

describe('event pipeline', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    run(db, "INSERT INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES ('USD',1,'ecb','x',0)");
    run(db, "INSERT INTO devices (id, secret_hash, alerts_enabled, push_token, home_region, currency, switch_regions, steam_regions, created_at, last_seen) VALUES ('on','x',1,'ExponentPushToken[a]','US','USD','[]','[\"US\"]',0,0)");
    run(db, "INSERT INTO devices (id, secret_hash, alerts_enabled, home_region, currency, switch_regions, steam_regions, created_at, last_seen) VALUES ('off','x',0,'US','USD','[]','[\"US\"]',0,0)");
    run(db, "INSERT INTO devices (id, secret_hash, alerts_enabled, home_region, currency, switch_regions, steam_regions, event_alerts, created_at, last_seen) VALUES ('nosteam','x',1,'US','USD','[]','[\"US\"]','{\"platforms\":[\"switch\"]}',0,0)");
    for (const h of week(9000)) recordSaleCount(db, 'steam', h.count, h.t);
  });
  afterEach(() => vi.useRealTimers());

  it('fires once per sale, only for people who want it, and closes the event after', () => {
    recordSaleCount(db, 'steam', 38000, now);
    const events = detectSaleEvents(db, now);
    expect(events).toHaveLength(1);
    const sent = all<{ device_id: string; title: string }>(db, "SELECT device_id, title FROM notifications WHERE kind = 'event'");
    expect(sent).toEqual([{ device_id: 'on', title: 'A big Steam sale is on' }]);

    recordSaleCount(db, 'steam', 41000, now + HOUR);
    detectSaleEvents(db, now + HOUR);
    expect(all(db, "SELECT 1 FROM notifications WHERE kind = 'event'")).toHaveLength(1);
    expect(all<{ peak: number }>(db, 'SELECT peak FROM sale_events')[0].peak).toBe(41000);

    recordSaleCount(db, 'steam', 9500, now + 5 * 24 * HOUR);
    expect(detectSaleEvents(db, now + 5 * 24 * HOUR)).toHaveLength(0);
  });

  it('sends at most one big-deals digest per person every 12 hours', () => {
    run(db, "INSERT INTO games (id, platform, title, title_key, steam_app_id, rank, on_sale, created_at, updated_at) VALUES ('steam:1','steam','Hades','hades',1,3,1,0,0)");
    run(db, "INSERT INTO prices VALUES ('steam:1','US','USD',25,10,60,'2026-11-27T00:00:00Z',?,?)", now, now);
    expect(queueBigDeals(db, now)).toBe(1);
    run(db, "INSERT INTO games (id, platform, title, title_key, steam_app_id, rank, on_sale, created_at, updated_at) VALUES ('steam:2','steam','Celeste','celeste',2,4,1,0,0)");
    run(db, "INSERT INTO prices VALUES ('steam:2','US','USD',20,5,75,'2026-11-27T00:00:00Z',?,?)", now, now);
    expect(queueBigDeals(db, now + HOUR)).toBe(0);
    // Later, only the new game is mentioned
    expect(queueBigDeals(db, now + 13 * HOUR)).toBe(1);
    const last = all<{ title: string }>(db, "SELECT title FROM notifications WHERE kind = 'deals' ORDER BY id DESC LIMIT 1")[0];
    expect(last.title).toBe('Celeste is 75% off');
  });

  it('exposes live events to the app', async () => {
    recordSaleCount(db, 'steam', 38000, now);
    detectSaleEvents(db, now);
    const body = (await (await createApp(db).request('/v1/events')).json()) as { items: { platform: string; count: number }[] };
    expect(body.items[0]).toMatchObject({ platform: 'steam', count: 38000 });
  });
});

describe('migrations', () => {
  it('adds new columns to a database created by an older version', () => {
    const path = join(tmpdir(), `gamely-migrate-${process.pid}.db`);
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE devices (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)');
    old.close();
    const db = openDb(path);
    const cols = all<{ name: string }>(db, 'PRAGMA table_info(devices)').map((c) => c.name);
    expect(cols).toContain('event_alerts');
    db.close();
  });
});
