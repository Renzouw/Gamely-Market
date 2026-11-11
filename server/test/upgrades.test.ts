import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiUpgradeList } from '@shared/api';
import { listingKind, withoutEdition } from '@shared/listing';
import { euDocToGame } from '@shared/stores/nintendo';
import { all, openDb, run, type Db } from '../src/db';
import { createApp } from '../src/api/app';
import { syncEuCatalog } from '../src/ingest/catalog';
import { refreshSwitchPrices } from '../src/ingest/prices';

// Europe's real listings for Tears of the Kingdom (2026-11-11): the Switch 2 Edition is listed
// under the upgrade pack's ID first, then the full Edition's.
const BASE = { title: 'The Legend of Zelda: Tears of the Kingdom', nsuid_txt: ['70010000063715'], playable_on_txt: ['HAC'], application_id_s: '0100f2c0115b6000', publisher: 'Nintendo' };
const EDITION = {
  title: 'The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition',
  nsuid_txt: ['70050000056808', '70010000096822'],
  playable_on_txt: ['BEE'],
  system_names_txt: ['Nintendo Switch 2'],
  application_id_s: '0100f2c0115b6000',
  publisher: 'Nintendo',
};
const FRIEND = { title: "It Takes Two - Friend's Pass", nsuid_txt: ['70010000137328'], playable_on_txt: ['BEE'], application_id_s: '0100aaaa00000000' };

// GB prices: the Switch game on sale at half price makes the upgrade route much cheaper
const GB: Record<string, { regular: string; sale?: string }> = {
  '70010000063715': { regular: '59.99', sale: '29.99' },
  '70050000056808': { regular: '7.99' },
  '70010000096822': { regular: '66.99' },
};

describe('reading listings', () => {
  it('keys a Switch 2 Edition by the full game, keeping its upgrade pack alongside', () => {
    const g = euDocToGame(EDITION)!;
    expect(g.key).toBe('sw:eu:70010000096822');
    expect(g.upgradeNsuid).toBe('70050000056808');
    expect(euDocToGame(BASE)!.upgradeNsuid).toBeUndefined();
  });

  it('tells upgrade packs and Friend’s Passes from games', () => {
    expect(listingKind({ key: 'sw:eu:70050000056808', title: 'Zelda – Nintendo Switch 2 Edition' })).toBe('upgrade');
    expect(listingKind({ key: 'sw:eu:70010000098625', title: 'FANTASY LIFE i - Nintendo Switch™ 2 Edition Upgrade Pack' })).toBe('upgrade');
    expect(listingKind({ key: 'sw:eu:70010000137328', title: "It Takes Two - Friend's Pass" })).toBe('friend');
    expect(listingKind({ key: 'sw:eu:70010000012123', title: 'My Friend Pedro' })).toBe('game');
    expect(withoutEdition(EDITION.title)).toBe('The Legend of Zelda: Tears of the Kingdom');
  });
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.host === 'searching.nintendo-europe.com') return json({ response: { numFound: 3, docs: [BASE, EDITION, FRIEND] } });
      if (u.host === 'api.ec.nintendo.com') {
        const ids = u.searchParams.get('ids')!.split(',');
        return json({
          prices: ids.map((id) =>
            GB[id]
              ? {
                  title_id: Number(id),
                  sales_status: 'onsale',
                  regular_price: { currency: 'GBP', raw_value: GB[id].regular },
                  ...(GB[id].sale ? { discount_price: { currency: 'GBP', raw_value: GB[id].sale, end_datetime: '2099-01-01T00:00:00Z' } } : {}),
                }
              : { title_id: Number(id), sales_status: 'not_found' },
          ),
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('upgrade packs', () => {
  it('files the upgrade pack as its own, clearly named listing tied to the Edition', async () => {
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    expect(all(db, "SELECT id, title FROM games WHERE id LIKE 'sw:eu:7005%'")).toEqual([
      { id: 'sw:eu:70050000056808', title: 'The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition Upgrade Pack' },
    ]);
    expect(all(db, 'SELECT edition_id, pack_id FROM upgrades')).toEqual([{ edition_id: 'sw:eu:70010000096822', pack_id: 'sw:eu:70050000056808' }]);
  });

  it('works out what the Switch game plus upgrade saves against the Edition', async () => {
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    run(db, "INSERT INTO fx (currency, per_usd, source, as_of, fetched_at) VALUES ('USD',1,'ecb','2026-11-11',0), ('GBP',0.8,'ecb','2026-11-11',0)");
    await refreshSwitchPrices(db, ['sw:eu:70010000063715', 'sw:eu:70050000056808', 'sw:eu:70010000096822'], ['GB']);
    const res = await createApp(db, {}).request('/v1/upgrades?home=GB&currency=GBP&regions=GB');
    const body = (await res.json()) as ApiUpgradeList;
    expect(body.items).toHaveLength(1);
    const [item] = body.items;
    expect([item.base.key, item.pack.key, item.edition.key]).toEqual(['sw:eu:70010000063715', 'sw:eu:70050000056808', 'sw:eu:70010000096822']);
    expect(item.best).toMatchObject({ country: 'GB', base: 29.99, pack: 7.99, edition: 66.99, baseSale: true, converted: { combo: 37.98, saving: 29.01 } });
  });

  it('unhooks an upgrade pack ID that was taken for a game’s own, with the prices it caused', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gamely-')), 'test.db');
    const old = openDb(path);
    run(old, "INSERT INTO games (id, platform, title, title_key, created_at, updated_at) VALUES ('sw:us:1','switch2','Cult of the Lamb – Nintendo Switch 2 Edition','x',0,0)");
    run(old, "INSERT INTO game_ids (grp, nsuid, game_id, match_method) VALUES ('europe','70050000082668','sw:us:1','title_publisher'), ('americas','70010000141412','sw:us:1','source')");
    run(old, "INSERT INTO prices (game_id, country, currency, regular, discount, checked_at, changed_at) VALUES ('sw:us:1','GB','GBP',4.99,0,0,0), ('sw:us:1','US','USD',24.99,0,0,0)");
    old.close();
    const db2 = openDb(path);
    expect(all(db2, "SELECT grp FROM game_ids WHERE game_id = 'sw:us:1'")).toEqual([{ grp: 'americas' }]);
    expect(all(db2, "SELECT country FROM prices WHERE game_id = 'sw:us:1'")).toEqual([{ country: 'US' }]);
  });
});
