import { DEFAULT_ALERTS } from '@shared/api';
import { summarize } from '@shared/pricing';
import type { RegionPrice } from '@shared/types';
import { directDeals, directGames, directPrices, directSwitchCountries } from '../direct';
import { localLows, useLocalHistory } from '../direct/history';
import { planLocalAlert } from '../services/localPlan';
import type { LocalWatch } from '../state/watchlist';

const fx = { base: 'USD', rates: { USD: 1, GBP: 0.8, EUR: 0.9 }, updatedAt: 0 };
const ctx = { home: 'GB', currency: 'USD', switchRegions: ['GB', 'DE', 'US', 'JP'], steamRegions: ['US'] };
const price = (country: string, currency: string, regular: number, sale?: number, ends?: string): RegionPrice => ({
  country,
  regular: { amount: regular, currency },
  sale: sale !== undefined ? { amount: sale, currency } : undefined,
  discountPercent: sale !== undefined ? Math.round((1 - sale / regular) * 100) : 0,
  saleEndsAt: ends,
});
const watch = (over: Partial<LocalWatch> = {}): LocalWatch => ({
  game: { key: 'sw:eu:1', platform: 'switch', title: 'Zelda', onSale: false, maxDiscount: 0 },
  alerts: { ...DEFAULT_ALERTS },
  createdAt: 0,
  updatedAt: 0,
  synced: false,
  sent: [],
  ...over,
});
const sum = (prices: RegionPrice[]) => summarize(prices, { homeCurrency: 'USD', homeRegion: 'GB', fx });

describe('phone-side alerts', () => {
  it('needs a previous check before saying "went on sale"', () => {
    const now = [price('GB', 'GBP', 40, 20)];
    expect(planLocalAlert(watch(), sum(now), 'USD', undefined)).toBeUndefined();
    const a = planLocalAlert(watch({ last: { onSale: false, homeOnSale: false, best: 50, checkedAt: 0 } }), sum(now), 'USD', undefined);
    expect(a?.kind).toBe('sale');
    expect(a?.title).toBe('Zelda is on sale');
  });

  it('alerts at the target even on the first check', () => {
    const a = planLocalAlert(watch({ target: 30 }), sum([price('GB', 'GBP', 40, 20)]), 'USD', undefined);
    expect(a?.kind).toBe('target');
  });

  it('shows each alert once', () => {
    const w = watch({ target: 30 });
    const first = planLocalAlert(w, sum([price('GB', 'GBP', 40, 20)]), 'USD', undefined)!;
    expect(planLocalAlert({ ...w, sent: [first.key] }, sum([price('GB', 'GBP', 40, 20)]), 'USD', undefined)).toBeUndefined();
  });

  it('calls a new low only against what the phone has seen before', () => {
    const w = watch({ last: { onSale: true, homeOnSale: true, best: 25, checkedAt: 0 } });
    expect(planLocalAlert(w, sum([price('GB', 'GBP', 40, 16)]), 'USD', 25)?.kind).toBe('low');
    expect(planLocalAlert(w, sum([price('GB', 'GBP', 40, 16)]), 'USD', 15)).toBeUndefined();
  });

  it('reminds you when a sale ends within a day', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    const w = watch({ last: { onSale: true, homeOnSale: true, best: 25, checkedAt: 0 }, alerts: { ...DEFAULT_ALERTS, low: false } });
    const a = planLocalAlert(w, summarize([price('GB', 'GBP', 40, 20, '2026-11-05T10:00:00Z')], { homeCurrency: 'USD', homeRegion: 'GB', fx }), 'USD', undefined, now);
    expect(a?.kind).toBe('ending');
    expect(a?.body).toContain('10h');
  });
});

describe('phone-only data', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  it('prices only the eShops the phone can reach on its own', () => {
    expect(directSwitchCountries(ctx)).toEqual(['GB', 'DE']);
  });

  it('asks each country once for a whole list, and survives one country failing', async () => {
    const asked: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      const country = u.searchParams.get('country')!;
      asked.push(country);
      if (country === 'DE') return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ prices: u.searchParams.get('ids')!.split(',').map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency: 'GBP', raw_value: '40' } })) }));
    }) as unknown as typeof fetch;
    const games = [1, 2, 3].map((i) => ({ key: `sw:eu:${i}`, platform: 'switch' as const, nsuids: { europe: String(i) } }));
    const out = await directPrices(games, ctx);
    expect(asked.sort()).toEqual(['DE', 'GB']);
    expect(out.get('sw:eu:2')!.map((p) => p.country)).toEqual(['GB']);
  });

  it('prices Japan, Hong Kong and Korea with IDs the server already found', async () => {
    const asked: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      asked.push(`${u.searchParams.get('country')}:${u.searchParams.get('ids')}`);
      const currency = { JP: 'JPY', HK: 'HKD', KR: 'KRW' }[u.searchParams.get('country')!] ?? 'GBP';
      return new Response(JSON.stringify({ prices: u.searchParams.get('ids')!.split(',').map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency, raw_value: '449' } })) }));
    }) as unknown as typeof fetch;
    // Donkey Kong Bananza's real IDs in each group
    const bananza = { key: 'sw:eu:70010000096810', platform: 'switch2' as const, nsuids: { europe: '70010000096810', japan: '70010000096306', hongkong: '70010000096812', korea: '70010000096811' } };
    const out = await directPrices([bananza], { ...ctx, switchRegions: ['GB', 'JP', 'HK', 'KR'] });
    expect(asked.sort()).toEqual(['GB:70010000096810', 'HK:70010000096812', 'JP:70010000096306', 'KR:70010000096811']);
    expect(out.get(bananza.key)!.map((p) => `${p.country} ${p.regular.currency}`).sort()).toEqual(['GB GBP', 'HK HKD', 'JP JPY', 'KR KRW']);
  });

  it('builds a deals page in the server’s shape, with filters applied', async () => {
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      if (u.host === 'searching.nintendo-europe.com') {
        return new Response(JSON.stringify({ response: { numFound: 2, docs: [
          { title: 'Deep Cut', nsuid_txt: ['1'], playable_on_txt: ['HAC'] },
          { title: 'Small Cut', nsuid_txt: ['2'], playable_on_txt: ['HAC'] },
        ] } }));
      }
      const ids = u.searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify({ prices: ids.map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency: 'GBP', raw_value: '40' }, discount_price: { currency: 'GBP', raw_value: id === '1' ? '10' : '36' } })) }));
    }) as unknown as typeof fetch;
    const page = await directDeals({ platform: 'switch', sort: 'popular', home: 'GB', currency: 'USD', regions: ['GB', 'DE'], minDiscount: 50 }, ctx, fx);
    expect(page.items.map((i) => i.game.title)).toEqual(['Deep Cut']);
    expect(page.items[0].game.onSale).toBe(true);
    expect(page.items[0].prices[0].checkedAt).toBeGreaterThan(0);
  });

  it('narrows a deals page to one eShop when a country is picked', async () => {
    const asked: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      if (u.host === 'searching.nintendo-europe.com') {
        return new Response(JSON.stringify({ response: { numFound: 2, docs: [
          { title: 'German Sale', nsuid_txt: ['1'], playable_on_txt: ['HAC'] },
          { title: 'UK Sale', nsuid_txt: ['2'], playable_on_txt: ['HAC'] },
        ] } }));
      }
      const country = u.searchParams.get('country')!;
      asked.push(country);
      const ids = u.searchParams.get('ids')!.split(',');
      const onSale = (id: string) => (id === '1' ? country === 'DE' : country === 'GB');
      return new Response(JSON.stringify({ prices: ids.map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency: 'EUR', raw_value: '40' }, discount_price: onSale(id) ? { currency: 'EUR', raw_value: '20' } : undefined })) }));
    }) as unknown as typeof fetch;
    const page = await directDeals({ platform: 'switch', sort: 'popular', home: 'GB', currency: 'USD', regions: ['GB', 'DE'], country: 'DE' }, ctx, fx);
    expect(asked).toEqual(['DE']);
    expect(page.items.map((i) => i.game.title)).toEqual(['German Sale']);
    expect(page.items[0].prices.map((p) => p.country)).toEqual(['DE']);
  });

  it('sorts and filters the directory with Europe’s own catalog search', async () => {
    let euQuery = '';
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      if (u.host === 'searching.nintendo-europe.com') {
        euQuery = decodeURIComponent(u.search);
        return new Response(JSON.stringify({ response: { numFound: 2, docs: [
          { title: 'Cheap One', nsuid_txt: ['1'], playable_on_txt: ['HAC'] },
          { title: 'Dear One', nsuid_txt: ['2'], playable_on_txt: ['HAC'] },
        ] } }));
      }
      const ids = u.searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify({ prices: ids.map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency: 'GBP', raw_value: id === '1' ? '8' : '40' }, discount_price: { currency: 'GBP', raw_value: id === '1' ? '4' : '30' } })) }));
    }) as unknown as typeof fetch;
    // $5 at 0.8 GBP per USD; the other game is $37.50
    const page = await directGames('switch', '', ctx, undefined, { sort: 'cheapest', onSale: true, maxPrice: 10 }, fx);
    expect(euQuery).toContain('price_sorting_f asc');
    expect(euQuery).toContain('price_has_discount_b:true');
    expect(page.items.map((i) => i.game.title)).toEqual(['Cheap One']);
  });

  it('keeps price history compact and finds the lowest price', () => {
    const rec = useLocalHistory.getState().record;
    rec('k', [price('GB', 'GBP', 40)], 1);
    rec('k', [price('GB', 'GBP', 40)], 2);
    rec('k', [price('GB', 'GBP', 40, 20)], 3);
    const rows = useLocalHistory.getState().games.k.rows;
    expect(rows.map((r) => r.t)).toEqual([1, 3]);
    expect(localLows(rows)).toEqual([{ country: 'GB', currency: 'GBP', price: 20, at: 3 }]);
  });
});
