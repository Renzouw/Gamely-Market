import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERTS } from '@shared/api';
import { planAlertCandidates } from '../src/alerts/plan';
import { queueAlertsForChanges } from '../src/alerts/run';
import { createApp } from '../src/api/app';
import { dailyBest } from '@shared/history';
import { parseCursor } from '../src/api/listings';
import { config } from '../src/config';
import { all, get, openDb, run, type Db } from '../src/db';
import { queueBigDeals } from '../src/events/run';
import { steamCountriesInUse, withPriceLock } from '../src/ingest/prices';
import { dispatch } from '../src/push/dispatch';
import { applyPrice, refreshSaleFlags, removePrice, type PriceRow } from '../src/store';

const fx = { base: 'USD', rates: { USD: 1, GBP: 0.8, EUR: 0.9 }, updatedAt: 0 };
const device = { id: 'd1', currency: 'USD', homeRegion: 'GB', switchRegions: ['GB', 'DE'], steamRegions: [] };
const row = (country: string, currency: string, regular: number, sale: number | null, ends: string | null = null): PriceRow => ({
  game_id: 'g', country, currency, regular, sale, discount: sale ? Math.round((1 - sale / regular) * 100) : 0, sale_ends_at: ends, checked_at: 0, changed_at: 0,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  run(db, "INSERT INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES ('USD',1,'ecb','x',0), ('GBP',0.8,'ecb','x',0), ('EUR',0.9,'ecb','x',0)");
});
afterEach(() => vi.unstubAllGlobals());

async function newDevice(app: ReturnType<typeof createApp>, settings: Record<string, unknown> = {}) {
  const reg = (await (await app.request('/v1/devices', { method: 'POST' })).json()) as { id: string; secret: string };
  const headers = { Authorization: `Bearer ${reg.id}.${reg.secret}`, 'Content-Type': 'application/json' };
  const body = { homeRegion: 'GB', currency: 'USD', switchRegions: ['GB', 'DE'], steamRegions: [], tz: 'UTC', alertsEnabled: true, ...settings };
  await app.request('/v1/devices/me', { method: 'PUT', headers, body: JSON.stringify(body) });
  return { id: reg.id, headers };
}

describe('alerts that used to go missing', () => {
  it('alerts again when a later sale hits the same target price', () => {
    const w = { gameId: 'g', title: 'Zelda', platform: 'switch' as const, target: 20, alerts: { ...DEFAULT_ALERTS } };
    const before = [row('GB', 'GBP', 32, null)];
    const nov = planAlertCandidates({ device, watch: w, before, after: [row('GB', 'GBP', 32, 15.99, '2026-11-30T00:00:00Z')], newLowCountries: [], fx, now: Date.parse('2026-11-10') });
    const dec = planAlertCandidates({ device, watch: w, before, after: [row('GB', 'GBP', 32, 15.99, '2026-12-31T00:00:00Z')], newLowCountries: [], fx, now: Date.parse('2026-12-10') });
    expect(nov[0].kind).toBe('target');
    expect(dec[0].kind).toBe('target');
    expect(nov[0].dedupeKey).not.toBe(dec[0].dedupeKey);
  });

  it('falls through to the next alert when the top one was already sent', () => {
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('g','switch','Zelda','zelda',0,0)");
    run(db, "INSERT INTO devices (id, secret_hash, home_region, currency, switch_regions, steam_regions, created_at, last_seen) VALUES ('d1','x','GB','USD','[\"GB\",\"DE\"]','[]',0,0)");
    run(db, "INSERT INTO watches (device_id, game_id, target, alerts, created_at) VALUES ('d1','g',30,'{}',0)");
    applyPrice(db, 'g', { country: 'GB', regular: { amount: 40, currency: 'GBP' }, discountPercent: 0 }, 1);
    const c = applyPrice(db, 'g', { country: 'GB', regular: { amount: 40, currency: 'GBP' }, sale: { amount: 20, currency: 'GBP' }, discountPercent: 50, saleEndsAt: '2099-01-01T00:00:00Z' }, 2)!;
    // Pretend the target alert for this exact sale was already sent by an earlier run
    const [top] = planAlertCandidates({ device, watch: { gameId: 'g', title: 'Zelda', platform: 'switch', target: 30, alerts: { ...DEFAULT_ALERTS } }, before: [c.before!], after: [c.after!], newLowCountries: [], fx });
    run(db, "INSERT INTO notifications (device_id, game_id, kind, dedupe_key, title, body, created_at, send_after) VALUES ('d1','g','target',?, 't','b',0,0)", top.dedupeKey);
    expect(queueAlertsForChanges(db, [c])).toBe(1);
    // The next most important alert goes out instead of nothing
    expect(all<{ kind: string }>(db, 'SELECT kind FROM notifications ORDER BY id').map((n) => n.kind)).toEqual(['target', 'low']);
  });

  it('runs price refreshes one at a time', async () => {
    const order: string[] = [];
    const slow = withPriceLock(async () => {
      order.push('a start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a end');
    });
    const fast = withPriceLock(async () => void order.push('b'));
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });

  it('keeps a push queued when Expo is unreachable, then sends it', async () => {
    run(db, "INSERT INTO devices (id, secret_hash, push_token, alerts_enabled, created_at, last_seen) VALUES ('d1','x','ExponentPushToken[a]',1,0,0)");
    run(db, "INSERT INTO notifications (device_id, kind, dedupe_key, title, body, created_at, send_after) VALUES ('d1','sale','k','t','b',0,0)");
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const r1 = await dispatch(db, 1000);
    expect(r1.retried).toBe(1);
    const n = get<{ status: string; attempts: number; send_after: number }>(db, 'SELECT status, attempts, send_after FROM notifications')!;
    expect(n).toMatchObject({ status: 'pending', attempts: 1, send_after: 61_000 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'ok', id: 't1' }] }), { status: 200 })));
    expect((await dispatch(db, 61_000)).sent).toBe(1);
  }, 20_000);

  it('gives a big-deals digest a real expiry when the sale end is unknown', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    run(db, "INSERT INTO devices (id, secret_hash, alerts_enabled, home_region, currency, switch_regions, steam_regions, created_at, last_seen) VALUES ('d1','x',1,'US','USD','[]','[\"US\"]',0,0)");
    run(db, "INSERT INTO games (id, platform, title, title_key, steam_app_id, rank, on_sale, created_at, updated_at) VALUES ('steam:1','steam','Hades','hades',1,3,1,0,0)");
    run(db, "INSERT INTO prices VALUES ('steam:1','US','USD',25,10,60,NULL,?,?)", now, now);
    expect(queueBigDeals(db, now)).toBe(1);
    expect(get<{ expires_at: number }>(db, "SELECT expires_at FROM notifications WHERE kind = 'deals'")!.expires_at).toBe(now + 48 * 3600_000);
  });
});

describe('data accuracy', () => {
  it('does not count an ended sale as on sale', () => {
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('g','switch','G','g',0,0)");
    run(db, "INSERT INTO prices VALUES ('g','GB','GBP',40,20,50,'2020-01-01T00:00:00Z',0,0)");
    refreshSaleFlags(db, ['g']);
    expect(get(db, "SELECT on_sale, max_discount FROM games WHERE id = 'g'")).toEqual({ on_sale: 0, max_discount: 0 });
  });

  it('stops counting a delisted region in price history', () => {
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('g','switch','G','g',0,0)");
    applyPrice(db, 'g', { country: 'GB', regular: { amount: 8, currency: 'GBP' }, discountPercent: 0 }, 1);
    removePrice(db, 'g', 'GB', 2);
    const rows = all<{ country: string; t: number; currency: string; price: number; discount: number }>(db, 'SELECT country, t, currency, price, discount FROM price_history');
    // The day the game left the UK store, Germany is the only price
    const pts = dailyBest([...rows, { country: 'DE', t: 86400_000 + 5, currency: 'EUR', price: 18, discount: 0 }], 'USD', fx, 86400_000 * 2);
    expect(pts.at(-1)).toEqual({ t: 172800_000, best: 20, country: 'DE' });
  });

  it('prices the Steam store each person buys in, even outside the default list', () => {
    run(db, "INSERT INTO devices (id, secret_hash, home_region, steam_regions, created_at, last_seen) VALUES ('d1','x','NZ','[\"US\"]',0,0)");
    expect(steamCountriesInUse(db)).toContain('NZ');
  });

  it('treats a garbled or negative cursor as the first page', () => {
    expect(parseCursor('-5')).toBe(0);
    expect(parseCursor('abc')).toBe(0);
    expect(parseCursor('30')).toBe(30);
    expect(parseCursor(undefined)).toBe(0);
  });
});

describe('devices and watches', () => {
  it('moves a push token to the newest install so a phone never gets alerts twice', async () => {
    const app = createApp(db);
    const a = await newDevice(app, { pushToken: 'ExponentPushToken[same]' });
    const b = await newDevice(app, { pushToken: 'ExponentPushToken[same]' });
    expect(get(db, 'SELECT push_token FROM devices WHERE id = ?', a.id)).toEqual({ push_token: null });
    expect(get(db, 'SELECT push_token FROM devices WHERE id = ?', b.id)).toEqual({ push_token: 'ExponentPushToken[same]' });
  });

  it('converts target prices when the currency changes', async () => {
    const app = createApp(db);
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('g','switch','G','g',0,0)");
    const d = await newDevice(app);
    await app.request('/v1/watches/g', { method: 'PUT', headers: d.headers, body: JSON.stringify({ target: 20 }) });
    await app.request('/v1/devices/me', { method: 'PUT', headers: d.headers, body: JSON.stringify({ homeRegion: 'GB', currency: 'GBP', switchRegions: ['GB'], steamRegions: [], tz: 'UTC', alertsEnabled: true }) });
    expect(get(db, "SELECT target FROM watches WHERE game_id = 'g'")).toEqual({ target: 16 });
  });

  it('caps how many games one install can watch', async () => {
    const app = createApp(db);
    const d = await newDevice(app);
    const cap = config.maxWatchesPerDevice;
    for (let i = 0; i < cap + 1; i++) run(db, 'INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)', `g${i}`, 'switch', `G${i}`, `g${i}`);
    for (let i = 0; i < cap; i++) run(db, "INSERT INTO watches (device_id, game_id, alerts, created_at) VALUES (?, ?, '{}', 0)", d.id, `g${i}`);
    const res = await app.request(`/v1/watches/g${cap}`, { method: 'PUT', headers: d.headers, body: '{}' });
    expect(res.status).toBe(409);
  });

  it('refreshes a game on view at most once per window', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (calls.push(url), new Response(JSON.stringify({ prices: [] }), { status: 200 }))));
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('sw:eu:1','switch','G','g',0,0)");
    run(db, "INSERT INTO game_ids VALUES ('europe','1','sw:eu:1','source')");
    const app = createApp(db);
    await app.request('/v1/games/sw:eu:1?home=GB&currency=USD&regions=GB');
    const first = calls.length;
    await app.request('/v1/games/sw:eu:1?home=KR&currency=USD');
    await app.request('/v1/games/sw:eu:1?home=GB&currency=USD&regions=GB');
    expect(first).toBeGreaterThan(0);
    expect(calls.length).toBe(first);
  });

  it("ignores a spoofed X-Forwarded-For unless we're behind a trusted proxy", async () => {
    const app = createApp(db);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.request('/v1/devices', { method: 'POST', headers: { 'X-Forwarded-For': `10.0.0.${i}` } })).status;
    expect(last).toBe(429);
  });
});

describe('games found by the phone', () => {
  it('starts tracking a game the phone watched in phone-only mode', async () => {
    const app = createApp(db);
    const d = await newDevice(app);
    const res = await app.request('/v1/watches/sw:eu:70010000012345', {
      method: 'PUT',
      headers: d.headers,
      body: JSON.stringify({ target: 20, game: { platform: 'switch2', title: 'Found Offline', productCode: 'BEEPABCDB' } }),
    });
    expect(res.status).toBe(200);
    expect(get(db, "SELECT title, platform FROM games WHERE id = 'sw:eu:70010000012345'")).toEqual({ title: 'Found Offline', platform: 'switch2' });
    expect(get(db, "SELECT game_id FROM game_ids WHERE grp = 'europe' AND nsuid = '70010000012345'")).toEqual({ game_id: 'sw:eu:70010000012345' });
  });

  it('refuses ids it could never have made', async () => {
    const app = createApp(db);
    const d = await newDevice(app);
    const res = await app.request('/v1/watches/anything', { method: 'PUT', headers: d.headers, body: JSON.stringify({ game: { platform: 'steam', title: 'x' } }) });
    expect(res.status).toBe(404);
  });
});
