import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db, run, all } from '../src/db';
import { createApp } from '../src/api/app';
import { bumpVersion } from '../src/api/listings';
import { syncEuCatalog } from '../src/ingest/catalog';
import { refreshSwitchPrices } from '../src/ingest/prices';
import { queueAlertsForChanges } from '../src/alerts/run';
import { dispatch } from '../src/push/dispatch';
import { applyPrice, removePrice } from '../src/store';

/**
 * End to end with a fake store: catalog sync, price refresh, change
 * detection, alert queueing, push dispatch and the API on top.
 */

let db: Db;
let prices: Record<string, { regular: number; sale?: number; ends?: string; status?: string }>;
const pushes: unknown[] = [];

function fakeStore(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.host === 'searching.nintendo-europe.com') {
    return json({
      response: {
        numFound: 2,
        docs: [
          { title: 'Metroid Prime 4: Beyond', nsuid_txt: ['70010000000001'], playable_on_txt: ['BEE'], publisher: 'Nintendo', product_code_txt: ['BEEPAAAAB'] },
          { title: 'Hades', nsuid_txt: ['70010000000002'], playable_on_txt: ['HAC'], publisher: 'Supergiant Games' },
        ],
      },
    });
  }
  if (u.host === 'api.ec.nintendo.com') {
    const country = u.searchParams.get('country')!;
    const currency = country === 'GB' ? 'GBP' : 'EUR';
    return json({
      prices: u.searchParams.get('ids')!.split(',').map((id) => {
        const p = prices[`${id}:${country}`] ?? prices[id];
        if (!p || p.status) return { title_id: Number(id), sales_status: p?.status ?? 'not_found' };
        return {
          title_id: Number(id),
          sales_status: 'onsale',
          regular_price: { currency, raw_value: String(p.regular) },
          discount_price: p.sale !== undefined ? { currency, raw_value: String(p.sale), end_datetime: p.ends } : undefined,
        };
      }),
    });
  }
  if (u.host === 'exp.host') {
    const batch = JSON.parse(String(init?.body));
    pushes.push(...batch);
    return json({ data: batch.map((_: unknown, i: number) => ({ status: 'ok', id: `ticket-${pushes.length}-${i}` })) });
  }
  return new Response('not found', { status: 404 });
}

beforeEach(() => {
  db = openDb(':memory:');
  prices = { '70010000000001': { regular: 59.99 }, '70010000000002': { regular: 24.99 } };
  pushes.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => fakeStore(url, init)));
  run(db, "INSERT INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES ('USD',1,'ecb','2026-11-04',0), ('EUR',0.9,'ecb','2026-11-04',0), ('GBP',0.8,'ecb','2026-11-04',0)");
});
afterEach(() => vi.unstubAllGlobals());

async function device(app: ReturnType<typeof createApp>) {
  const reg = (await (await app.request('/v1/devices', { method: 'POST' })).json()) as { id: string; secret: string };
  const auth = { Authorization: `Bearer ${reg.id}.${reg.secret}`, 'Content-Type': 'application/json' };
  const put = await app.request('/v1/devices/me', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ pushToken: 'ExponentPushToken[abc]', homeRegion: 'GB', currency: 'USD', switchRegions: ['GB', 'DE'], steamRegions: [], tz: 'UTC', alertsEnabled: true }),
  });
  expect(put.status).toBe(200);
  return auth;
}

describe('pipeline', () => {
  it('goes from a price change at the store to a push on the phone', async () => {
    const app = createApp(db, { onPricesChanged: bumpVersion });
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    expect(all(db, 'SELECT id FROM games')).toHaveLength(2);
    await refreshSwitchPrices(db, ['sw:eu:70010000000001', 'sw:eu:70010000000002'], ['GB', 'DE']);

    const auth = await device(app);
    const w = await app.request('/v1/watches/sw:eu:70010000000001', { method: 'PUT', headers: auth, body: JSON.stringify({ target: 50 }) });
    expect(w.status).toBe(200);
    // Watching a game triggers a refresh in the background; let it finish
    await new Promise((r) => setTimeout(r, 50));

    // The store starts a sale in Germany
    prices['70010000000001:DE'] = { regular: 59.99, sale: 39.99, ends: '2099-01-01T00:00:00Z' };
    const changes = await refreshSwitchPrices(db, ['sw:eu:70010000000001'], ['GB', 'DE']);
    expect(changes).toHaveLength(1);
    expect(queueAlertsForChanges(db, changes)).toBe(1);
    bumpVersion();

    const res = await dispatch(db);
    expect(res.sent).toBe(1);
    expect(pushes[0]).toMatchObject({ to: 'ExponentPushToken[abc]', title: 'Metroid Prime 4: Beyond hit your price' });

    // The same price on the next refresh doesn't alert again
    const again = await refreshSwitchPrices(db, ['sw:eu:70010000000001'], ['GB', 'DE']);
    expect(again).toHaveLength(0);

    // It shows up in deals, priced in the caller's currency and regions
    const deals = (await (await app.request('/v1/deals?platform=switch2&home=GB&currency=USD&regions=GB,DE')).json()) as { items: { game: { key: string }; prices: { country: string }[] }[] };
    expect(deals.items.map((i) => i.game.key)).toEqual(['sw:eu:70010000000001']);
    expect(deals.items[0].prices.map((x) => x.country).sort()).toEqual(['DE', 'GB']);

    // ...but not for someone who can't buy in Germany
    const gbOnly = (await (await app.request('/v1/deals?platform=switch2&home=GB&currency=USD&regions=GB')).json()) as { items: unknown[] };
    expect(gbOnly.items).toHaveLength(0);

    // The activity feed shows what was sent
    const activity = (await (await app.request('/v1/activity', { headers: auth })).json()) as { items: { kind: string }[] };
    expect(activity.items[0].kind).toBe('target');
  });

  it("keeps the old price when a store request fails, rather than treating it as delisted", async () => {
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    await refreshSwitchPrices(db, ['sw:eu:70010000000002'], ['GB']);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(refreshSwitchPrices(db, ['sw:eu:70010000000002'], ['GB'])).rejects.toThrow();
    expect(all(db, "SELECT * FROM prices WHERE game_id = 'sw:eu:70010000000002'")).toHaveLength(1);
    const status = all<{ last_error: string }>(db, "SELECT last_error FROM source_status WHERE source = 'nintendo-prices'");
    expect(status[0].last_error).toContain('GB');
  });

  it('removes a price when the store says the game is no longer sold there', async () => {
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    await refreshSwitchPrices(db, ['sw:eu:70010000000002'], ['GB']);
    prices['70010000000002'] = { regular: 0, status: 'sales_termination' };
    const changes = await refreshSwitchPrices(db, ['sw:eu:70010000000002'], ['GB']);
    expect(changes[0].after).toBeUndefined();
    expect(all(db, "SELECT * FROM prices WHERE game_id = 'sw:eu:70010000000002'")).toHaveLength(0);
  });

  it('records history only when a price actually moves, and tracks the lowest', () => {
    run(db, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('g','switch','G','g',0,0)");
    const base = { country: 'GB', regular: { amount: 40, currency: 'GBP' }, discountPercent: 0 };
    applyPrice(db, 'g', base, 1);
    applyPrice(db, 'g', base, 2);
    const c = applyPrice(db, 'g', { ...base, sale: { amount: 20, currency: 'GBP' }, discountPercent: 50 }, 3);
    expect(c?.newLow).toBe(true);
    applyPrice(db, 'g', base, 4);
    expect(all(db, "SELECT t FROM price_history WHERE game_id = 'g' ORDER BY t").map((r: any) => r.t)).toEqual([1, 3, 4]);
    expect(all<{ price: number }>(db, "SELECT price FROM lows WHERE game_id = 'g'")[0].price).toBe(20);
    expect(removePrice(db, 'g', 'GB')?.before?.regular).toBe(40);
  });

  it('shows an expired sale at the regular price before the next refresh', async () => {
    const app = createApp(db);
    run(db, "INSERT INTO games (id, platform, title, title_key, on_sale, created_at, updated_at) VALUES ('sw:eu:9','switch','G','g',1,?,?)", Date.now(), Date.now());
    run(db, "INSERT INTO prices VALUES ('sw:eu:9','GB','GBP',40,20,50,'2020-01-01T00:00:00Z',?,?)", Date.now(), Date.now());
    const body = (await (await app.request('/v1/games/sw:eu:9?home=GB&currency=GBP&regions=GB')).json()) as { prices: { sale?: unknown; discountPercent: number }[] };
    expect(body.prices[0].sale).toBeUndefined();
    expect(body.prices[0].discountPercent).toBe(0);
  });

  it('rejects requests without a valid device secret', async () => {
    const app = createApp(db);
    expect((await app.request('/v1/watches', { headers: { Authorization: 'Bearer nope.nope' } })).status).toBe(401);
    expect((await app.request('/v1/deals?platform=switch2&home=XX&currency=USD')).status).toBe(400);
  });
});
