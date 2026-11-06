import { convert, discountPercent, endsSoon, formatMoney, rankByPrice, summarize, timeLeft, withConversion } from '@shared/pricing';
import { productCore, titleKey } from '@shared/match';
import { DEFAULT_SWITCH_REGIONS, guessHome, steamStoreCountry, withNewRegions } from '@shared/regions';
import { cardsFor, cardValues, enebaCardUrl, enebaCountryUrl, ESHOP_CARDS } from '@shared/eshopCards';
import type { FxRates, RegionPrice } from '@shared/types';

const fx: FxRates = { base: 'USD', rates: { USD: 1, MXN: 20, GBP: 0.8, EUR: 0.9, JPY: 150 }, updatedAt: 0 };

const price = (country: string, currency: string, regular: number, sale?: number, saleEndsAt?: string): RegionPrice => ({
  country,
  regular: { amount: regular, currency },
  sale: sale !== undefined ? { amount: sale, currency } : undefined,
  discountPercent: discountPercent(regular, sale),
  saleEndsAt,
});

describe('convert', () => {
  it('converts through the base currency', () => {
    expect(convert(20, 'MXN', 'USD', fx)).toBeCloseTo(1);
    expect(convert(8, 'GBP', 'EUR', fx)).toBeCloseTo(9);
  });
  it('is identity for the same currency, even without rates', () => {
    expect(convert(5, 'CHF', 'CHF')).toBe(5);
  });
  it('returns undefined for unknown currencies', () => {
    expect(convert(5, 'XYZ', 'USD', fx)).toBeUndefined();
    expect(convert(5, 'USD', 'EUR')).toBeUndefined();
  });
});

describe('summarize', () => {
  const prices = [
    price('US', 'USD', 60, 30),
    price('MX', 'MXN', 1200, 400), // $20
    price('GB', 'GBP', 50), // $62.5
    price('XX', 'XYZ', 10), // no rate
  ];

  it('ranks cheapest first and sinks unconvertible prices', () => {
    const ranked = rankByPrice(withConversion(prices, 'USD', fx));
    expect(ranked.map((p) => p.country)).toEqual(['MX', 'US', 'GB', 'XX']);
  });

  it('works out savings against the home region', () => {
    const s = summarize(prices, { homeCurrency: 'USD', homeRegion: 'US', fx });
    expect(s.best?.country).toBe('MX');
    expect(s.best?.converted).toBeCloseTo(20);
    expect(s.home?.converted).toBe(30);
    expect(s.savingVsHome).toBeCloseTo(1 / 3);
    expect(s.onSaleCount).toBe(2);
  });

  it('has no saving when home is the cheapest', () => {
    const s = summarize([price('US', 'USD', 10), price('GB', 'GBP', 50)], { homeCurrency: 'USD', homeRegion: 'US', fx });
    expect(s.best?.country).toBe('US');
    expect(s.savingVsHome).toBe(0);
  });

  it('treats free games as the cheapest', () => {
    const s = summarize([price('US', 'USD', 0), price('MX', 'MXN', 100)], { homeCurrency: 'USD', homeRegion: 'MX', fx });
    expect(s.best?.country).toBe('US');
  });
});

describe('formatting', () => {
  it('formats money with sensible decimals', () => {
    expect(formatMoney(12.5, 'USD', 'en-US')).toBe('$12.50');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney(0, 'USD')).toBe('Free');
    expect(formatMoney(undefined, 'USD')).toBe('–');
  });

  it('describes time left on a sale', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    expect(timeLeft('2026-11-07T04:00:00Z', now)).toBe('2d 4h');
    expect(timeLeft('2026-11-05T05:30:00Z', now)).toBe('5h');
    expect(timeLeft('2026-11-05T00:20:00Z', now)).toBe('20m');
    expect(timeLeft('2026-11-04T00:00:00Z', now)).toBeUndefined();
    expect(endsSoon('2026-11-06T00:00:00Z', now)).toBe(true);
    expect(endsSoon('2026-11-10T00:00:00Z', now)).toBe(false);
  });

  it('computes discount percentages', () => {
    expect(discountPercent(60, 45)).toBe(25);
    expect(discountPercent(60, 60)).toBe(0);
    expect(discountPercent(60)).toBe(0);
  });
});

describe('matching', () => {
  it('normalizes titles across regions', () => {
    expect(titleKey('Pokémon™ Legends: Z-A')).toBe(titleKey('Pokemon Legends Z-A'));
    expect(titleKey('The Legend of Zelda™: Tears of the Kingdom')).toBe(titleKey('Legend of Zelda: Tears of the Kingdom'));
    expect(titleKey('Mario & Sonic')).toBe('mario and sonic');
  });

  it('keeps editions distinct', () => {
    expect(titleKey('Super Mario Odyssey')).not.toBe(titleKey('Super Mario Odyssey – Nintendo Switch 2 Edition'));
  });

  it('extracts the shared product code core', () => {
    expect(productCore('HACPAAAAA')).toBe('HACAAAA');
    expect(productCore('HAC-P-AAAAB')).toBe('HACAAAA');
    expect(productCore('BEEPAB12J')).toBe('BEEAB12');
    expect(productCore('nope')).toBeUndefined();
    expect(productCore(undefined)).toBeUndefined();
  });
});

describe('regions', () => {
  it('guesses a home from the device locale', () => {
    expect(guessHome('MX', 'MXN')).toEqual({ region: 'MX', currency: 'MXN' });
    expect(guessHome('ZZ', null)).toEqual({ region: 'US', currency: 'USD' });
    expect(guessHome('PH', 'PHP')).toEqual({ region: 'US', currency: 'PHP' });
    expect(guessHome('IE', 'EUR')).toEqual({ region: 'DE', currency: 'EUR' });
    expect(guessHome('AT', 'EUR')).toEqual({ region: 'DE', currency: 'EUR' });
  });

  it('adds Hong Kong and Korea only to region lists that were never narrowed', () => {
    const before = DEFAULT_SWITCH_REGIONS.filter((c) => c !== 'HK' && c !== 'KR');
    expect(withNewRegions(before).slice(-2)).toEqual(['HK', 'KR']);
    expect(withNewRegions(['GB', 'JP'])).toEqual(['GB', 'JP']);
    expect(guessHome('HK', 'HKD')).toEqual({ region: 'HK', currency: 'HKD' });
  });

  it('picks a Steam store country', () => {
    expect(steamStoreCountry('FR')).toEqual({ code: 'DE', currency: 'EUR' });
    expect(steamStoreCountry('AR')).toEqual({ code: 'AR', currency: 'USD' });
    expect(steamStoreCountry('CL')).toEqual({ code: 'US', currency: 'USD' });
  });
});

describe('matching edge cases', () => {
  it("doesn't drop letters that look like articles mid-title", () => {
    expect(titleKey('Pokémon Legends: Z-A')).not.toBe(titleKey('Pokémon Legends: Z'));
  });
});

describe('eShop cards', () => {
  it('lists card values smallest first, marking digital-only ones', () => {
    const range = { countries: ['JP'], currency: 'JPY', amounts: [9000, 1000, 3000], digitalOnly: [5000, 3000], source: '', checked: '' };
    expect(cardValues(range)).toEqual([
      { amount: 1000, digitalOnly: false },
      { amount: 3000, digitalOnly: false },
      { amount: 5000, digitalOnly: true },
      { amount: 9000, digitalOnly: false },
    ]);
  });

  it('links to Eneba filtered to one country’s eShop cards, cheapest first', () => {
    expect(enebaCountryUrl('JP')).toBe('https://www.eneba.com/store/gift-cards?drms[]=nintendo&regions[]=japan&sortBy=PRICE_ASC&text=Nintendo%20eShop');
    // Euro cards are sold as "Europe" or for one country
    expect(enebaCountryUrl('DE')).toContain('regions[]=europe&regions[]=germany');
    expect(enebaCardUrl('JP', 3000, 'JPY')).toBe('https://www.eneba.com/store/gift-cards?drms[]=nintendo&regions[]=japan&sortBy=PRICE_ASC&text=Nintendo%20eShop%203000%20JPY');
    // Eneba doesn't sell Korean cards
    expect(enebaCountryUrl('KR')).toBeUndefined();
  });

  it('has an Eneba region for every card country except Korea', () => {
    for (const range of ESHOP_CARDS) for (const code of range.countries) expect(code === 'KR' || !!enebaCountryUrl(code)).toBe(true);
  });

  it('only lists countries whose card values were confirmed, with a source', () => {
    for (const range of ESHOP_CARDS) {
      expect(range.amounts.length + (range.digitalOnly?.length ?? 0)).toBeGreaterThan(0);
      expect(range.source).toMatch(/^https:\/\//);
      for (const code of range.countries) expect(cardsFor(code)).toBe(range);
    }
  });
});
