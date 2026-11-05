import { parsePriceResponse } from '../api/nintendo/prices';
import { euDocToGame, euPlatform } from '../api/nintendo/catalogEu';
import { usHitToGame } from '../api/nintendo/catalogUs';
import { pickJapanMatch } from '../api/nintendo/catalogJp';
import { mergeCatalogs, priceSwitchGames } from '../api/nintendo';

describe('eShop price parsing', () => {
  it('reads regular and sale prices', () => {
    const map = parsePriceResponse('MX', {
      country: 'MX',
      prices: [
        {
          title_id: 70010000000001,
          sales_status: 'onsale',
          regular_price: { amount: '$1,199.00', currency: 'MXN', raw_value: '1199' },
          discount_price: { amount: '$599.50', currency: 'MXN', raw_value: '599.5', end_datetime: '2026-11-20T07:59:59Z' },
        },
        {
          title_id: 70010000000002,
          sales_status: 'onsale',
          regular_price: { amount: '$399.00', currency: 'MXN', raw_value: '399' },
        },
        { title_id: 70010000000003, sales_status: 'not_found' },
      ],
    });
    expect(map.size).toBe(2);
    const a = map.get('70010000000001')!;
    expect(a.regular).toEqual({ amount: 1199, currency: 'MXN' });
    expect(a.sale).toEqual({ amount: 599.5, currency: 'MXN' });
    expect(a.discountPercent).toBe(50);
    expect(a.saleEndsAt).toBe('2026-11-20T07:59:59Z');
    const b = map.get('70010000000002')!;
    expect(b.sale).toBeUndefined();
    expect(b.discountPercent).toBe(0);
  });
});

describe('Europe catalog', () => {
  const doc = {
    title: 'Mario Kart World',
    nsuid_txt: ['70010000099999'],
    product_code_txt: ['BEEPAAAAB'],
    image_url_h2x1_s: '//fs-prod-cdn.nintendo-europe.com/x.jpg',
    url: '/Games/Nintendo-Switch-2-games/Mario-Kart-World/',
    publisher: 'Nintendo',
    dates_released_dts: ['2025-06-05T00:00:00Z'],
    playable_on_txt: ['BEE'],
  };

  it('maps a document to a game', () => {
    const g = euDocToGame(doc)!;
    expect(g.key).toBe('sw:eu:70010000099999');
    expect(g.platform).toBe('switch2');
    expect(g.image).toBe('https://fs-prod-cdn.nintendo-europe.com/x.jpg');
    expect(g.nsuids).toEqual({ europe: '70010000099999' });
    expect(g.productCode).toBe('BEEPAAAAB');
    expect(g.storeUrl).toContain('/Games/Nintendo-Switch-2-games/');
  });

  it('detects the platform from several fields', () => {
    expect(euPlatform({ playable_on_txt: ['HAC'] })).toBe('switch');
    expect(euPlatform({ system_names_txt: ['Nintendo Switch 2'] })).toBe('switch2');
    expect(euPlatform({ product_code_txt: ['BEEPABCDA'] })).toBe('switch2');
  });

  it('skips documents without an id', () => {
    expect(euDocToGame({ title: 'No id' })).toBeUndefined();
  });
});

describe('Americas catalog', () => {
  it('maps a hit and its US price', () => {
    const g = usHitToGame({
      title: 'Mario Kart™ World',
      nsuid: '70010000088888',
      url: '/us/store/products/mario-kart-world-switch-2/',
      productImage: 'ncom/en_US/games/switch-2/m/mario-kart-world',
      corePlatforms: ['Nintendo Switch 2'],
      price: { regPrice: 79.99, finalPrice: 59.99, salePrice: 59.99 },
    })!;
    expect(g.platform).toBe('switch2');
    expect(g.nsuids).toEqual({ americas: '70010000088888' });
    expect(g.image).toMatch(/^https:\/\/assets\.nintendo\.com\/.*mario-kart-world$/);
    expect(g.listPrice?.sale?.amount).toBe(59.99);
    expect(g.listPrice?.discountPercent).toBe(25);
  });
});

describe('Japan matching', () => {
  it('matches by product code core', () => {
    const items = [
      { nsuid: '70010000011111', pcode: 'HACPZZZZJ' },
      { nsuid: '70010000022222', pcode: 'HACPAAAAJ' },
    ];
    expect(pickJapanMatch(items, 'HACPAAAAB')).toBe('70010000022222');
    expect(pickJapanMatch(items, 'HACPQQQQB')).toBeUndefined();
  });
});

describe('merging catalogs', () => {
  it('joins the same game from both regions', () => {
    const eu = [euDocToGame({ title: 'Pokémon™ Legends: Z-A', nsuid_txt: ['7001E'], playable_on_txt: ['HAC'] })!];
    const us = [
      usHitToGame({ title: 'Pokemon Legends: Z-A', nsuid: '7001A', corePlatforms: ['Nintendo Switch'] })!,
      usHitToGame({ title: 'Only In US', nsuid: '7001B', corePlatforms: ['Nintendo Switch'] })!,
    ];
    const merged = mergeCatalogs(eu, us);
    expect(merged).toHaveLength(2);
    expect(merged[0].nsuids).toEqual({ europe: '7001E', americas: '7001A' });
    expect(merged[1].key).toBe('sw:us:7001B');
  });

  it("doesn't join a Switch 2 game with its Switch 1 version", () => {
    const eu = [euDocToGame({ title: 'Some Game', nsuid_txt: ['1'], playable_on_txt: ['BEE'] })!];
    const us = [usHitToGame({ title: 'Some Game', nsuid: '2', corePlatforms: ['Nintendo Switch'] })!];
    expect(mergeCatalogs(eu, us)).toHaveLength(2);
  });
});

describe('pricing a list across countries', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks each country only for IDs from its own catalog group', async () => {
    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      const country = u.searchParams.get('country')!;
      const ids = u.searchParams.get('ids')!.split(',');
      const currency = country === 'GB' ? 'GBP' : country === 'MX' ? 'MXN' : 'EUR';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          prices: ids.map((id) => ({
            title_id: Number(id),
            sales_status: 'onsale',
            regular_price: { currency, raw_value: '10' },
          })),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const games = [
      { key: 'a', platform: 'switch' as const, title: 'A', nsuids: { europe: '100', americas: '200' } },
      { key: 'b', platform: 'switch' as const, title: 'B', nsuids: { europe: '101' } },
    ];
    const result = await priceSwitchGames(games, ['GB', 'DE', 'MX']);

    expect(calls).toHaveLength(3);
    const mxCall = calls.find((u) => u.includes('country=MX'))!;
    expect(decodeURIComponent(mxCall)).toContain('ids=200');
    expect(result.get('a')!.map((p) => p.country).sort()).toEqual(['DE', 'GB', 'MX']);
    expect(result.get('b')!.map((p) => p.country).sort()).toEqual(['DE', 'GB']);
  });
});
