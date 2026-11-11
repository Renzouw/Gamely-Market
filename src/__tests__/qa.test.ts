/**
 * Cases found in the November code audit, each a bug that showed a wrong price,
 * saving or alert. Kept apart so it's clear what each one guards.
 */
import { decodeLinks, encodeLinks } from '@shared/links';
import { discountPercent, summarize } from '@shared/pricing';
import { steamStoreCountry } from '@shared/regions';
import { mergeFx } from '@shared/stores/fx';
import { parsePriceResponse } from '@shared/stores/nintendo';
import type { RegionPrice } from '@shared/types';
import { DEFAULT_ALERTS } from '@shared/api';
import { directPrices, forgetPrices } from '../direct';
import { parseTarget } from '../lib/format';
import { planLocalAlert } from '../services/localPlan';
import { forgetLinks, rememberLinks } from '../state/links';
import type { LocalWatch } from '../state/watchlist';

const price = (country: string, currency: string, regular: number, sale?: number): RegionPrice => ({
  country,
  regular: { amount: regular, currency },
  sale: sale !== undefined ? { amount: sale, currency } : undefined,
  discountPercent: sale !== undefined ? discountPercent(regular, sale) : 0,
});

describe('store prices', () => {
  it('skips a price the store left out instead of calling it Free', () => {
    const { prices } = parsePriceResponse('PH', {
      prices: [
        { title_id: 1, sales_status: 'onsale', regular_price: { currency: 'PHP', raw_value: null as unknown as string } },
        { title_id: 2, sales_status: 'onsale', regular_price: { currency: 'PHP', raw_value: '' } },
        { title_id: 3, sales_status: 'onsale', regular_price: { currency: 'PHP', raw_value: '0' } },
        { title_id: 4, sales_status: 'onsale', regular_price: { currency: 'PHP', raw_value: '3700' }, discount_price: { currency: 'PHP', raw_value: null as unknown as string } },
      ],
    });
    expect(prices.has('1')).toBe(false);
    expect(prices.has('2')).toBe(false);
    expect(prices.get('3')?.regular.amount).toBe(0); // a real free game
    expect(prices.get('4')).toMatchObject({ regular: { amount: 3700 }, sale: undefined });
  });

  it('never shows a real discount as 0% off', () => {
    expect(discountPercent(1199, 1195)).toBe(1);
    expect(discountPercent(1199, 1199)).toBe(0);
  });
});

describe('best price', () => {
  it('gives a tie to your own eShop', () => {
    const fx = { base: 'USD', rates: { USD: 1, EUR: 0.9 }, updatedAt: 0 };
    const s = summarize([price('DE', 'EUR', 59.99), price('FR', 'EUR', 59.99)], { homeCurrency: 'USD', homeRegion: 'FR', fx });
    expect(s.best?.country).toBe('FR');
    expect(s.savingVsHome).toBe(0);
  });
});

describe('regions', () => {
  it('sends Sweden, Denmark and Czechia to Steam’s euro store', () => {
    for (const c of ['SE', 'DK', 'CZ']) expect(steamStoreCountry(c)).toEqual({ code: 'DE', currency: 'EUR' });
  });
});

describe('exchange rates', () => {
  it('keeps every rate when the backup feed’s date can’t be read', () => {
    const quotes = mergeFx({ base: 'USD', date: '2026-11-11', rates: { EUR: 0.9 } }, { result: 'success', time_last_update_utc: 'not a date', rates: { ARS: 1400 } }, ['EUR', 'ARS']);
    expect(quotes.map((q) => [q.currency, q.asOf])).toEqual([
      ['USD', '2026-11-11'],
      ['EUR', '2026-11-11'],
      ['ARS', '2026-11-11'],
    ]);
  });
});

describe('server matches saved on the phone', () => {
  it('reads a copy with Windows line endings', () => {
    expect(decodeLinks('0000096810,0000096809\r\n0000000127,,0000000828').get('70010000096810')).toEqual({ americas: '70010000096809' });
  });
});

describe('target price box', () => {
  it('reads thousands separators and decimal commas the way people type them', () => {
    expect(parseTarget('1,500')).toBe(1500);
    expect(parseTarget('1,500.50')).toBe(1500.5);
    expect(parseTarget('12,99')).toBe(12.99);
    expect(parseTarget('1499.')).toBe(1499);
    expect(parseTarget('abc')).toBeUndefined();
    expect(parseTarget('0')).toBeUndefined();
  });
});

describe('phone-side alerts', () => {
  const fx = { base: 'USD', rates: { USD: 1, GBP: 0.8, JPY: 150 }, updatedAt: 0 };
  const watch = (last: LocalWatch['last']): LocalWatch => ({
    game: { key: 'sw:eu:1', platform: 'switch', title: 'Zelda', onSale: false, maxDiscount: 0 },
    alerts: { ...DEFAULT_ALERTS, drop: true },
    createdAt: 0,
    updatedAt: 0,
    synced: false,
    sent: [],
    last,
  });

  it('doesn’t call a currency move a price drop', () => {
    // ¥7,500 was $50 last time; the yen strengthened, the price didn't change
    const today = { ...fx, rates: { ...fx.rates, JPY: 148 } };
    const s = summarize([price('JP', 'JPY', 7500)], { homeCurrency: 'USD', homeRegion: 'JP', fx: today });
    const w = watch({ best: 50, bestLocal: { amount: 7500, currency: 'JPY' }, country: 'JP', onSale: false, homeOnSale: false, checkedAt: 0 });
    expect(planLocalAlert(w, s, 'USD', undefined, Date.now(), today)).toBeUndefined();
  });

  it('doesn’t say "went on sale" when a sale was already on elsewhere', () => {
    const s = summarize([price('GB', 'GBP', 40, 20), price('JP', 'JPY', 9000)], { homeCurrency: 'USD', homeRegion: 'JP', fx });
    const w = watch({ best: 25, bestLocal: { amount: 20, currency: 'GBP' }, country: 'GB', onSale: true, homeOnSale: false, checkedAt: 0 });
    expect(planLocalAlert(w, s, 'USD', undefined, Date.now(), fx)?.kind).not.toBe('sale');
  });
});

describe('phone-only mode', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    forgetPrices();
  });

  it('prices your home eShop outside Europe even when it isn’t ticked', async () => {
    forgetLinks();
    // Bananza's Southeast Asian ID (the sixth column)
    await rememberLinks(encodeLinks([{ europe: '70010000096810', links: { sea: '70010000108853' } }]));
    const asked: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      const u = new URL(url);
      asked.push(`${u.searchParams.get('country')}:${u.searchParams.get('ids')}`);
      return new Response(JSON.stringify({ prices: u.searchParams.get('ids')!.split(',').map((id) => ({ title_id: Number(id), sales_status: 'onsale', regular_price: { currency: 'PHP', raw_value: '3700' } })) }));
    }) as unknown as typeof fetch;
    const bananza = { key: 'sw:eu:70010000096810', platform: 'switch2' as const, nsuids: { europe: '70010000096810' } };
    const prices = await directPrices([bananza], { home: 'PH', currency: 'PHP', switchRegions: ['GB'], steamRegions: [] });
    expect(asked).toContain('PH:70010000108853');
    expect(prices.get(bananza.key)?.map((p) => p.country)).toContain('PH');
  });
});

describe('upgrade packs list', () => {
  const { upgradeSummary } = jest.requireActual('../lib/upgrades') as typeof import('../lib/upgrades');
  const game = (key: string, title: string) => ({ key, title, platform: 'switch2' as const, onSale: false, maxDiscount: 0 });
  const route = (country: string, base: number, pack: number, edition?: number) => ({
    country,
    currency: 'PHP',
    base,
    pack,
    edition,
    baseSale: false,
    packSale: false,
    editionSale: false,
    converted: { base, pack, combo: base + pack, edition, saving: edition === undefined ? undefined : edition - (base + pack) },
  });
  const item = (over: object) => ({
    edition: game('sw:eu:1', 'Overcooked! 2 – Nintendo Switch 2 Edition'),
    base: game('sw:eu:2', 'Overcooked! 2'),
    pack: game('sw:eu:3', 'Overcooked! 2 – Nintendo Switch 2 Edition Upgrade Pack'),
    countries: [],
    ...over,
  });

  it('leads with the Edition when buying it whole is cheapest (Overcooked! 2, 2026-11-11)', () => {
    // The trick "saves" ₱1,476 in Switzerland against its own pricey Edition, but the Edition costs ₱1,004 at home
    const s = upgradeSummary(
      item({
        cheapestEdition: { country: 'PH', currency: 'PHP', amount: 1004, sale: false, converted: 1004 },
        cheapestUpgrade: route('CZ', 698, 335, 2100),
        saving: -29,
        home: route('PH', 836, 335, 1004),
        best: route('CH', 671, 767, 2913),
      }),
      'PHP',
      'Overcooked! 2',
    );
    expect(s.cheapest).toBe('Switch 2 Edition ₱1,004 in 🇵🇭 Philippines');
    expect(s.other).toBe('Switch game + upgrade from ₱1,033 in 🇨🇿 Czechia');
    expect(s.verdict).toEqual({ text: 'Edition', tone: 'subtle', detail: '₱29 cheaper' });
    expect(s.home).toBe('In your eShop 🇵🇭: ₱836 + ₱335 = ₱1,171, ₱167 more than the Edition there');
  });

  it('says how much the upgrade route saves when it beats the Edition anywhere', () => {
    const s = upgradeSummary(
      item({
        cheapestEdition: { country: 'ZA', currency: 'PHP', amount: 1074, sale: false, converted: 1074 },
        cheapestUpgrade: { ...route('ZA', 859, 0, 1074), baseSale: true },
        saving: 215,
      }),
      'PHP',
      'SiN Reloaded',
    );
    expect(s.cheapest).toBe('Switch game ₱859 (sale) + upgrade Free = ₱859 in 🇿🇦 South Africa');
    expect(s.other).toBe('Edition from ₱1,074 in 🇿🇦 South Africa');
    expect(s.verdict).toEqual({ text: 'Save ₱215', tone: 'signal', detail: '−20%' });
    expect(s.home).toBeUndefined();
  });
});
