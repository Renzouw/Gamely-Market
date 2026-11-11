/**
 * Cases found in the November code audit. Each was a bug that showed a wrong price or
 * link, raised a false alert, or slowly broke matching; kept together so it's clear
 * what each one guards.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERTS } from '@shared/api';
import { planAlertCandidates, type DeviceCtx } from '../src/alerts/plan';
import { all, openDb, run } from '../src/db';
import { syncRegionCatalogs } from '../src/ingest/regions';
import { fetchHkAppId } from '../src/sources/nintendo/catalogRegions';
import { applyPrice, removePrice, type PriceRow } from '../src/store';

afterEach(() => vi.unstubAllGlobals());

const game = (db: ReturnType<typeof openDb>, id: string, platform = 'switch', rank: number | null = null) =>
  run(db, 'INSERT INTO games (id, platform, title, title_key, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)', id, platform, id, id, rank);

describe('Hong Kong title pages', () => {
  it('takes a missing page (404) as a final "no ID", but retries a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    await expect(fetchHkAppId('70010000000001')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    await expect(fetchHkAppId('70010000000001')).rejects.toThrow();
  });
});

describe('regional catalogs', () => {
  it('keeps the catalog when a store answers empty, instead of forgetting every listing', async () => {
    const db = openDb(':memory:');
    run(db, "INSERT INTO region_catalog (grp, nsuid, platform, code_key, title, seen_at) VALUES ('sea','70010000108820','switch2','BEEAXN7','Zelda',0)");
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (new URL(url).host === 'search.nintendo.jp' ? new Response(JSON.stringify({ result: { total: 0, items: [] } })) : new Response('no', { status: 404 }))),
    );
    await syncRegionCatalogs(db, 1000);
    expect(all(db, "SELECT nsuid FROM region_catalog WHERE grp = 'sea'")).toEqual([{ nsuid: '70010000108820' }]);
    expect(all(db, "SELECT last_error FROM source_status WHERE source = 'nintendo-sea-catalog'")).toEqual([{ last_error: 'sea catalog came back short: 0 of 0' }]);
  });
});

describe('upgrade packs that used to be the Edition', () => {
  it('moves the Edition’s links and prices off the pack, and drops its old rank', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gamely-')), 'test.db');
    const old = openDb(path);
    game(old, 'sw:eu:70010000099001', 'switch2'); // the real Edition, Europe only so far
    game(old, 'sw:eu:70050000099002', 'switch2', 13); // the pack, once filed as the Edition
    run(old, "INSERT INTO upgrades (edition_id, pack_id) VALUES ('sw:eu:70010000099001','sw:eu:70050000099002')");
    run(
      old,
      `INSERT INTO game_ids (grp, nsuid, game_id, match_method) VALUES
        ('europe','70010000099001','sw:eu:70010000099001','source'), ('europe','70050000099002','sw:eu:70050000099002','source'),
        ('japan','70010000099003','sw:eu:70050000099002','product_code'),
        ('sea','70050000099004','sw:eu:70050000099002','product_code')`,
    );
    run(
      old,
      `INSERT INTO prices (game_id, country, currency, regular, discount, checked_at, changed_at) VALUES
        ('sw:eu:70050000099002','JP','JPY',9100,0,0,0), ('sw:eu:70050000099002','GB','GBP',16.99,0,0,0)`,
    );
    old.close();

    const db = openDb(path);
    expect(all(db, "SELECT game_id FROM game_ids WHERE grp = 'japan'")).toEqual([{ game_id: 'sw:eu:70010000099001' }]);
    // The pack's own Southeast Asian ID (an add-on ID, 7005) is the pack's and stays
    expect(all(db, "SELECT game_id FROM game_ids WHERE grp = 'sea'")).toEqual([{ game_id: 'sw:eu:70050000099002' }]);
    expect(all(db, "SELECT game_id, country FROM prices ORDER BY game_id, country")).toEqual([
      { game_id: 'sw:eu:70010000099001', country: 'JP' },
      { game_id: 'sw:eu:70050000099002', country: 'GB' }, // the pack's own European price stays
    ]);
    expect(all(db, "SELECT rank FROM games WHERE id = 'sw:eu:70050000099002'")).toEqual([{ rank: null }]);
  });
});

describe('price history', () => {
  const p = (amount: number, sale?: number) => ({ country: 'GB', regular: { amount, currency: 'GBP' }, sale: sale !== undefined ? { amount: sale, currency: 'GBP' } : undefined, discountPercent: 0 });

  it('marks a country that never sold the game once, so it stops being asked again', () => {
    const db = openDb(':memory:');
    game(db, 'g');
    removePrice(db, 'g', 'JP', 1);
    removePrice(db, 'g', 'JP', 2);
    expect(all(db, "SELECT t, discount FROM price_history WHERE game_id = 'g'")).toEqual([{ t: 1, discount: -1 }]);
  });

  it('calls a relisting at an all-time low a new low', () => {
    const db = openDb(':memory:');
    game(db, 'g');
    applyPrice(db, 'g', p(40), 1);
    expect(applyPrice(db, 'g', p(40, 20), 2)?.newLow).toBe(true);
    removePrice(db, 'g', 'GB', 3);
    expect(applyPrice(db, 'g', p(40, 15), 4)?.newLow).toBe(true);
  });
});

describe('alerts', () => {
  const device: DeviceCtx = { id: 'd', currency: 'GBP', homeRegion: 'GB', switchRegions: ['GB'] };
  const row = (sale: number | null): PriceRow => ({ game_id: 'g', country: 'GB', currency: 'GBP', regular: 40, sale, discount: sale ? 50 : 0, sale_ends_at: null, checked_at: 0, changed_at: 0 });

  it('doesn’t say "went on sale" for a game priced for the first time', () => {
    const plans = planAlertCandidates({ device, watch: { gameId: 'g', title: 'Zelda', platform: 'switch', alerts: { ...DEFAULT_ALERTS } }, before: [], after: [row(20)], newLowCountries: [] });
    expect(plans.map((x) => x.kind)).not.toContain('sale');
  });

  it('still does when the same country was priced before without a sale', () => {
    const plans = planAlertCandidates({ device, watch: { gameId: 'g', title: 'Zelda', platform: 'switch', alerts: { ...DEFAULT_ALERTS } }, before: [row(null)], after: [row(20)], newLowCountries: [] });
    expect(plans.map((x) => x.kind)).toContain('sale');
  });
});

describe('a store that blocks us', () => {
  it('is left alone after an "Access Denied" page, and the first answer that gets through ends the pause', async () => {
    const { request, forgetPauses, HostPausedError } = await import('../src/sources/http');
    forgetPauses();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (calls++, new Response('<HTML>Access Denied</HTML>', { status: 403, headers: { 'content-type': 'text/html' } }))));
    await expect(request('https://api.ec.nintendo.com/v1/price?country=GB')).rejects.toThrow('HTTP 403');
    await expect(request('https://api.ec.nintendo.com/v1/price?country=JP')).rejects.toBeInstanceOf(HostPausedError);
    expect(calls).toBe(1); // the second one never went out
    // Other stores carry on
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(request('https://store.steampowered.com/api/x')).resolves.toBeDefined();
    forgetPauses();
  });

  it('isn’t triggered by an API that says no with data (an expired search key)', async () => {
    const { request, forgetPauses } = await import('../src/sources/http');
    forgetPauses();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (calls++, new Response('{"message":"Invalid API key"}', { status: 403, headers: { 'content-type': 'application/json' } }))));
    await expect(request('https://u3b6gr4ua3-dsn.algolia.net/1/indexes/x/query')).rejects.toThrow('HTTP 403');
    await expect(request('https://u3b6gr4ua3-dsn.algolia.net/1/indexes/x/query')).rejects.toThrow('HTTP 403');
    expect(calls).toBe(2);
  });
});
