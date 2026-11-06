import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, openDb, run, type Db } from '../src/db';
import { createApp } from '../src/api/app';
import { syncEuCatalog } from '../src/ingest/catalog';
import { refreshSwitchPrices } from '../src/ingest/prices';
import { linkRegions, syncRegionCatalogs } from '../src/ingest/regions';
import { codeKey, parseEshopAppId } from '../src/sources/nintendo/catalogRegions';
import { isOverdue, markRun } from '../src/store';
import { asiaCatalogPlan, parseAsiaResponse, parseJpResponse } from '@shared/stores/nintendoRegions';
import { decodeLinks } from '@shared/links';

/**
 * Fixtures are real responses saved on 2026-11-06, trimmed to a handful of
 * games: Japan's search, the Hong Kong and Korea software search, and the
 * part of three Hong Kong eShop title pages that names the application ID.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const jp = JSON.parse(fixture('jp-search.json'));
const hk = JSON.parse(fixture('hk-search.json'));
const kr = JSON.parse(fixture('kr-search.json'));

// Real European catalog entries (trimmed). Bananza and both Tears of the
// Kingdom entries have no product code; Odyssey has one.
const EU_DOCS = [
  { title: 'Donkey Kong Bananza', nsuid_txt: ['70010000096810', '70070000030750'], playable_on_txt: ['BEE'], publisher: 'Nintendo', dates_released_dts: ['2025-07-17T00:00:00Z', '2025-09-12T00:00:00Z'], application_id_s: '040074a01bf12000' },
  { title: 'The Legend of Zelda: Tears of the Kingdom', nsuid_txt: ['70010000063715'], playable_on_txt: ['HAC'], product_code_txt: [''], publisher: 'Nintendo', dates_released_dts: ['2023-05-12T00:00:00Z'], application_id_s: '0100f2c0115b6000' },
  { title: 'The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition', nsuid_txt: ['70010000096822', '70050000056808'], playable_on_txt: ['BEE'], publisher: 'Nintendo', dates_released_dts: ['2025-06-05T00:00:00Z'], application_id_s: '0100f2c0115b6000' },
  { title: 'Super Mario Odyssey', nsuid_txt: ['70010000000127'], playable_on_txt: ['HAC'], product_code_txt: ['HACPAAACA'], publisher: 'Nintendo', dates_released_dts: ['2017-10-27T00:00:00Z'], application_id_s: '0100000000010000' },
];

describe('regional catalog parsing', () => {
  it('builds a key from hardware and the 4-character code core', () => {
    expect(codeKey('switch2', 'aaaca')).toBe('BEEAAAC');
    expect(codeKey('switch', 'AAACA')).toBe('HACAAAC'); // same core, different game
    expect(codeKey('switch', '')).toBeUndefined();
    expect(codeKey('switch', 'AAAC')).toBeUndefined();
  });

  it('keeps only full games from Japan, keyed by platform', () => {
    const { entries } = parseJpResponse(jp);
    expect(entries.map((e) => [e.nsuid, e.codeKey, e.platform])).toEqual([
      ['70010000096306', 'BEEAAAC', 'switch2'], // Donkey Kong Bananza
      ['70010000096248', 'BEEAXN7', 'switch2'], // Tears of the Kingdom, Switch 2 Edition
      ['70010000063713', 'HACAXN7', 'switch'], // Tears of the Kingdom
      ['70010000000828', 'HACAAAC', 'switch'], // Super Mario Odyssey
    ]);
    // The Bananza DLC set and the Edition upgrade share a code but aren't games
    expect(entries.some((e) => e.nsuid.startsWith('7007') || e.nsuid.startsWith('7005'))).toBe(false);
    expect(entries[0].releaseDate).toBe('2025-07-17');
  });

  it('reads Hong Kong and Korea, skipping unreleased placeholders', () => {
    expect(parseAsiaResponse(hk).entries.map((e) => [e.nsuid, e.codeKey])).toEqual([
      ['70010000096812', 'BEEAAAC'],
      ['70010000096824', 'BEEAXN7'],
      ['70010000063717', 'HACAXN7'],
      ['70010000009372', 'HACAAAC'],
    ]);
    const k = parseAsiaResponse(kr);
    expect(k.count).toBe(4);
    expect(k.entries.map((e) => e.nsuid)).toEqual(['70010000096811', '70010000063716', '70010000009372']);
  });

  it('reads the application ID from a Hong Kong title page, only for the title asked for', () => {
    const page = fixture('eshop-hk-70010000096812.txt');
    expect(parseEshopAppId(page, '70010000096812')).toBe('040074a01bf12000');
    expect(parseEshopAppId(page, '70010000096811')).toBeUndefined();
    expect(parseEshopAppId('<html>nothing here</html>', '70010000096812')).toBeUndefined();
  });

  it('reads past the search cap from the oldest end', () => {
    expect(asiaCatalogPlan(4670)).toEqual([{ order: 'newest', page: 0 }]);
    expect(asiaCatalogPlan(10631)).toEqual([
      { order: 'newest', page: 0 },
      { order: 'newest', page: 1 },
      { order: 'oldest', page: 0 },
    ]);
  });
});

let db: Db;
let docs: typeof EU_DOCS;
let jpData: typeof jp;
let titlePages: string[];

function fakeStore(url: string): Response {
  const u = new URL(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.host === 'searching.nintendo-europe.com') return json({ response: { numFound: docs.length, docs } });
  if (u.host === 'search.nintendo.jp') return json(jpData);
  if (u.host === 'www.nintendo.com' && u.pathname === '/hk/api/search') return json(hk);
  if (u.host === 'www.nintendo.com' && u.pathname === '/kr/api/search') return json(kr);
  if (u.host === 'ec.nintendo.com') {
    const nsuid = u.pathname.split('/').pop()!;
    titlePages.push(nsuid);
    const file = join(__dirname, 'fixtures', `eshop-hk-${nsuid}.txt`);
    return existsSync(file) ? new Response(readFileSync(file, 'utf8'), { status: 200 }) : new Response('not found', { status: 404 });
  }
  if (u.host === 'api.ec.nintendo.com') {
    const country = u.searchParams.get('country')!;
    const currency = { JP: 'JPY', HK: 'HKD', KR: 'KRW' }[country] ?? 'EUR';
    return json({
      prices: u.searchParams.get('ids')!.split(',').map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency, raw_value: country === 'KR' ? '79800' : '449' } })),
    });
  }
  return new Response('not found', { status: 404 });
}

const links = (gameId: string) =>
  Object.fromEntries(all<{ grp: string; nsuid: string }>(db, 'SELECT grp, nsuid FROM game_ids WHERE game_id = ? ORDER BY grp', gameId).map((r) => [r.grp, r.nsuid]));

beforeEach(() => {
  db = openDb(':memory:');
  docs = EU_DOCS.map((d) => ({ ...d }));
  jpData = jp;
  titlePages = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fakeStore(url)));
});
afterEach(() => vi.unstubAllGlobals());

async function syncAll() {
  await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
  await syncRegionCatalogs(db);
  return linkRegions(db);
}

describe('linking Japan, Hong Kong and Korea', () => {
  it('links Donkey Kong Bananza through its application ID, then its code', async () => {
    const linked = await syncAll();
    expect(links('sw:eu:70010000096810')).toEqual({ europe: '70010000096810', hongkong: '70010000096812', japan: '70010000096306', korea: '70010000096811' });
    expect(all(db, "SELECT match_method FROM game_ids WHERE game_id = 'sw:eu:70010000096810' AND grp = 'hongkong'")).toEqual([{ match_method: 'application_id' }]);
    expect(linked).toContain('sw:eu:70010000096810');
  });

  it('keeps a Switch 2 Edition apart from the Switch game with the same application ID', async () => {
    await syncAll();
    // Japan and Hong Kong sell both; Korea's list has only the Switch game
    expect(links('sw:eu:70010000063715')).toEqual({ europe: '70010000063715', hongkong: '70010000063717', japan: '70010000063713', korea: '70010000063716' });
    expect(links('sw:eu:70010000096822')).toEqual({ europe: '70010000096822', hongkong: '70010000096824', japan: '70010000096248' });
  });

  it('links by product code alone when Europe has one, with no page lookups', async () => {
    await syncAll();
    expect(links('sw:eu:70010000000127')).toEqual({ europe: '70010000000127', hongkong: '70010000009372', japan: '70010000000828', korea: '70010000009372' });
    expect(titlePages).not.toContain('70010000009372');
  });

  it('remembers application IDs, so the next run fetches no pages', async () => {
    await syncAll();
    const first = titlePages.length;
    expect(first).toBeGreaterThan(0);
    run(db, 'DELETE FROM game_ids WHERE grp != ?', 'europe');
    run(db, 'UPDATE games SET region_checked_at = NULL, code_key = NULL');
    await linkRegions(db);
    expect(titlePages.length).toBe(first);
    expect(links('sw:eu:70010000096810').japan).toBe('70010000096306');
  });

  it('leaves out a code two of our games share', async () => {
    docs.push({ ...EU_DOCS[3], title: 'Super Mario Odyssey Bundle', nsuid_txt: ['70010000099999'], application_id_s: '0100000000099999' });
    await syncAll();
    expect(links('sw:eu:70010000000127')).toEqual({ europe: '70010000000127' });
    expect(links('sw:eu:70010000099999')).toEqual({ europe: '70010000099999' });
  });

  it('leaves out a listing whose application ID disagrees', async () => {
    // Europe says Bananza is a different application than the Hong Kong page does
    docs[0] = { ...docs[0], application_id_s: '0400000000000000' };
    await syncAll();
    expect(links('sw:eu:70010000096810')).toEqual({ europe: '70010000096810' });
  });

  it('leaves out Japan when two full games there share the code', async () => {
    const twin = { ...jp.result.items[0], nsuid: '70010000099998', id: '70010000099998' };
    jpData = { result: { ...jp.result, items: [...jp.result.items, twin] } };
    await syncAll();
    const l = links('sw:eu:70010000096810');
    expect(l.japan).toBeUndefined();
    expect(l.hongkong).toBe('70010000096812');
  });

  it('prices the linked regions and stops calling them unmatched', async () => {
    await syncAll();
    run(db, "INSERT INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES ('USD',1,'ecb','2026-11-06',0), ('JPY',150,'ecb','2026-11-06',0), ('HKD',7.8,'ecb','2026-11-06',0), ('KRW',1400,'ecb','2026-11-06',0)");
    await refreshSwitchPrices(db, ['sw:eu:70010000096810'], ['JP', 'HK', 'KR']);
    const res = await createApp(db, {}).request('/v1/games/sw:eu:70010000096810?home=JP&currency=USD&regions=JP,HK,KR');
    const body = (await res.json()) as { prices: { country: string; regular: { amount: number; currency: string } }[]; unmatched: string[] };
    expect(body.prices.map((p) => `${p.country} ${p.regular.amount} ${p.regular.currency}`).sort()).toEqual(['HK 449 HKD', 'JP 449 JPY', 'KR 79800 KRW']);
    expect(body.unmatched).toEqual([]);
  });

  it('hands the phone every match outside Europe, for phone-only mode', async () => {
    await syncAll();
    const res = (await (await createApp(db, {}).request('/v1/links')).json()) as { rows: string; count: number };
    const links = decodeLinks(res.rows);
    expect(links.get('70010000096810')).toEqual({ japan: '70010000096306', hongkong: '70010000096812', korea: '70010000096811' });
    expect(links.get('70010000000127')).toEqual({ japan: '70010000000828', hongkong: '70010000009372', korea: '70010000009372' });
    expect(res.count).toBe(links.size);
  });

  it('keeps the old catalog when a store answers short', async () => {
    await syncAll();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (new URL(url).pathname === '/hk/api/search' ? new Response(JSON.stringify({ items: [], total: 10631 })) : fakeStore(url))));
    await syncRegionCatalogs(db);
    expect(all(db, "SELECT COUNT(*) AS n FROM region_catalog WHERE grp = 'hongkong'")).toEqual([{ n: 4 }]);
    expect(all(db, "SELECT last_error FROM source_status WHERE source = 'nintendo-hongkong-catalog'")).toEqual([{ last_error: 'hongkong catalog came back short: 0 of 5000 on page 1' }]);
  });
});

describe('daily jobs across restarts', () => {
  it('counts a job as due until it has finished within its interval', () => {
    const db2 = openDb(':memory:');
    expect(isOverdue(db2, 'catalog', 1000, 5000)).toBe(true);
    markRun(db2, 'catalog', 5000);
    expect(isOverdue(db2, 'catalog', 1000, 5500)).toBe(false);
    expect(isOverdue(db2, 'catalog', 1000, 6000)).toBe(true);
  });
});
