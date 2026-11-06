import { describe, expect, it } from 'vitest';
import { parsePriceResponse } from '../src/sources/nintendo/prices';
import { euDocToGame, euPlatform } from '../src/sources/nintendo/catalogEu';
import { usHitToGame } from '../src/sources/nintendo/catalogUs';

describe('eShop price parsing', () => {
  it('reads regular and sale prices', () => {
    const { prices: map, gone } = parsePriceResponse('MX', {
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
    }, Date.parse('2026-11-05T00:00:00Z'));
    expect(gone.has('70010000000003')).toBe(true);
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

describe('discount windows', () => {
  it('ignores a discount that has not started yet or already ended', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    const { prices } = parsePriceResponse('GB', {
      prices: [
        {
          title_id: 1,
          sales_status: 'onsale',
          regular_price: { currency: 'GBP', raw_value: '49.99' },
          discount_price: { currency: 'GBP', raw_value: '24.99', start_datetime: '2026-11-06T00:00:00Z', end_datetime: '2026-11-20T00:00:00Z' },
        },
        {
          title_id: 2,
          sales_status: 'onsale',
          regular_price: { currency: 'GBP', raw_value: '49.99' },
          discount_price: { currency: 'GBP', raw_value: '24.99', start_datetime: '2026-10-01T00:00:00Z', end_datetime: '2026-11-01T00:00:00Z' },
        },
      ],
    }, now);
    expect(prices.get('1')?.sale).toBeUndefined();
    expect(prices.get('2')?.sale).toBeUndefined();
  });
});
