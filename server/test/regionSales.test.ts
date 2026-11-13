/**
 * Southeast Asia's games linked by English title, and the Southeast Asia and Japan
 * on-sale lists. Seen on 2026-11-13: Amnesia: Rebirth and SOMA were ₱177 in the
 * Philippines, but Europe has no product code for them, so they had no link there
 * and the app never showed the sale.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { titleKey } from '@shared/match';
import { jpSaleQuery } from '@shared/stores/nintendoRegions';
import { all, openDb, run } from '../src/db';
import { linkSeaByTitle, syncRegionSales } from '../src/ingest/regions';

afterEach(() => vi.unstubAllGlobals());

type Db = ReturnType<typeof openDb>;

const game = (db: Db, id: string, title: string, o: { platform?: string; code?: string; date?: string } = {}) =>
  run(
    db,
    'INSERT INTO games (id, platform, title, title_key, product_code, release_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
    id,
    o.platform ?? 'switch2',
    title,
    titleKey(title),
    o.code ?? null,
    o.date ?? null,
  );

const listing = (db: Db, nsuid: string, title: string, codeKey: string, o: { platform?: string; date?: string } = {}) =>
  run(
    db,
    "INSERT INTO region_catalog (grp, nsuid, platform, code_key, title, release_date, seen_at) VALUES ('sea', ?, ?, ?, ?, ?, 0)",
    nsuid,
    o.platform ?? 'switch2',
    codeKey,
    title,
    o.date ?? null,
  );

const seaIds = (db: Db) => all<{ game_id: string; nsuid: string }>(db, "SELECT game_id, nsuid FROM game_ids WHERE grp = 'sea' ORDER BY game_id");

describe('Southeast Asia by title', () => {
  it('links a game Europe has no product code for, and learns its code', () => {
    const db = openDb(':memory:');
    game(db, 'sw:eu:70010000121560', 'Amnesia: Rebirth', { date: '2026-04-30T00:00:00Z' });
    game(db, 'sw:eu:70010000132112', 'SOMA – Nintendo Switch™ 2 Edition');
    listing(db, '70010000121564', 'Amnesia: Rebirth', 'BEEAB59', { date: '2026-04-30' });
    listing(db, '70010000132116', 'SOMA - Nintendo Switch™ 2 Edition', 'BEEBQBX');

    expect(linkSeaByTitle(db).sort()).toEqual(['sw:eu:70010000121560', 'sw:eu:70010000132112']);
    expect(seaIds(db)).toEqual([
      { game_id: 'sw:eu:70010000121560', nsuid: '70010000121564' },
      { game_id: 'sw:eu:70010000132112', nsuid: '70010000132116' },
    ]);
    // The code then finds it in Japan, Hong Kong and Korea, at the next linking rather than next week
    expect(all(db, "SELECT code_key, region_checked_at FROM games WHERE id = 'sw:eu:70010000121560'")).toEqual([{ code_key: 'BEEAB59', region_checked_at: null }]);
    expect(linkSeaByTitle(db)).toEqual([]);
  });

  it('leaves a title alone when two games or two listings have it, or the platform differs', () => {
    const db = openDb(':memory:');
    game(db, 'sw:eu:1', 'Tetris');
    game(db, 'sw:us:2', 'TETRIS');
    listing(db, '70010000000001', 'Tetris', 'BEEAAAA');
    game(db, 'sw:eu:3', 'Solitaire');
    listing(db, '70010000000002', 'Solitaire', 'BEEAAAB');
    listing(db, '70010000000003', 'Solitaire', 'BEEAAAC');
    game(db, 'sw:eu:4', 'Puzzle Box', { platform: 'switch' });
    listing(db, '70010000000004', 'Puzzle Box', 'BEEAAAD');
    expect(linkSeaByTitle(db)).toEqual([]);
  });

  it('trusts a product code over the title, and skips a listing far older than the game', () => {
    const db = openDb(':memory:');
    game(db, 'sw:eu:1', 'Coded', { code: 'BEEPAAAAA' });
    listing(db, '70010000000001', 'Coded', 'BEEZZZZ');
    game(db, 'sw:eu:2', 'Remade', { date: '2026-06-01' });
    listing(db, '70010000000002', 'Remade', 'BEEAAAB', { date: '2019-03-01' });
    // Already out when Southeast Asia's eShop opened: dated that day there, which is fine
    game(db, 'sw:eu:3', 'Old Favourite', { date: '2019-03-01' });
    listing(db, '70010000000003', 'Old Favourite', 'BEEAAAC', { date: '2025-11-18' });
    expect(linkSeaByTitle(db)).toEqual(['sw:eu:3']);
  });

  it('doesn’t give a game a code another game already has', () => {
    const db = openDb(':memory:');
    game(db, 'sw:eu:1', 'Has It', { code: 'BEEPAAAAA' });
    game(db, 'sw:eu:2', 'Wants It');
    listing(db, '70010000000002', 'Wants It', 'BEEAAAA');
    expect(linkSeaByTitle(db)).toEqual(['sw:eu:2']);
    expect(all(db, "SELECT code_key FROM games WHERE id = 'sw:eu:2'")).toEqual([{ code_key: null }]);
  });
});

describe('regional sale lists', () => {
  const item = (nsuid: string, title: string, icode: string) => ({ nsuid, title, icode, hard: '05_BEE', sform: 'BEE_DL', dsdate: '2026-04-30 00:00:00', price: 889, current_price: 177, sale_flg: '1' });

  it('reads only discounted games', () => {
    expect(jpSaleQuery(0)).toMatchObject({ fq: 'sale_flg_s:1', limit: 300, page: 1 });
  });

  it('finds our games on sale in Southeast Asia, linking new ones by title, and in Japan', async () => {
    const db = openDb(':memory:');
    game(db, 'sw:eu:70010000121560', 'Amnesia: Rebirth');
    game(db, 'sw:eu:9', 'Linked Already');
    run(db, "INSERT INTO game_ids (grp, nsuid, game_id, match_method) VALUES ('japan','70010000000009','sw:eu:9','product_code')");
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        const items = url.includes('nintendo_soft_ph') ? [item('70010000121564', 'Amnesia: Rebirth', 'AB59A')] : [item('70010000000009', '別の名前', 'AAA9A')];
        return new Response(JSON.stringify({ result: { total: items.length, items } }));
      }),
    );
    const res = await syncRegionSales(db, 1000);
    expect(res).toEqual([
      { grp: 'sea', countries: ['PH', 'SG', 'MY', 'TH'], ids: ['sw:eu:70010000121560'] },
      { grp: 'japan', countries: ['JP'], ids: ['sw:eu:9'] },
    ]);
    expect(urls.every((u) => new URL(u).searchParams.get('fq') === 'sale_flg_s:1')).toBe(true);
    expect(seaIds(db)).toEqual([{ game_id: 'sw:eu:70010000121560', nsuid: '70010000121564' }]);
  });

  it('carries on with Japan when Southeast Asia fails', async () => {
    const db = openDb(':memory:');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('nintendo_soft_ph') ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ result: { total: 0, items: [] } })))),
    );
    const res = await syncRegionSales(db, 1000);
    expect(res.map((r) => r.grp)).toEqual(['japan']);
    expect(all(db, "SELECT source FROM source_status WHERE last_error IS NOT NULL")).toEqual([{ source: 'nintendo-sea-sales' }]);
  });
});
