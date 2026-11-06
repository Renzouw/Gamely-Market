/**
 * Official Nintendo eShop card values per country. They rarely change, so
 * they live here as data, each with where it was confirmed. A country is
 * only listed when its card values could be confirmed from Nintendo or a
 * major retailer; we don't guess.
 *
 * A card only works on an eShop account set to the country (or currency
 * area) it was sold for.
 */
import { SWITCH_REGIONS, type Region } from './regions';

export interface CardRange {
  /** Countries whose eShop accepts these cards */
  countries: string[];
  currency: string;
  /** Card values sold in shops, as physical cards or codes */
  amounts: number[];
  /** Values only sold as digital codes, if any */
  digitalOnly?: number[];
  /** Where the values were confirmed */
  source: string;
  checked: string;
}

const CHECKED = '6 Nov 2026';

/**
 * Left out on purpose: Argentina, Chile, Colombia and Peru have no eShop
 * cards (Nintendo sells them in Brazil only in Latin America). New Zealand,
 * Hong Kong, Czechia and South Africa: no card values could be confirmed.
 */
export const ESHOP_CARDS: CardRange[] = [
  { countries: ['US'], currency: 'USD', amounts: [10, 20, 35, 50, 100], digitalOnly: [5, 70], source: 'https://www.bestbuy.com/site/product/5784015.p', checked: CHECKED },
  { countries: ['CA'], currency: 'CAD', amounts: [10, 20, 35, 50], digitalOnly: [70], source: 'https://www.bestbuy.ca/en-ca/product/nintendo-eshop-70-gift-card-digital-download/11980673', checked: CHECKED },
  { countries: ['MX'], currency: 'MXN', amounts: [], digitalOnly: [100, 200, 350, 500, 1000], source: 'https://www.nuuvem.com/mx-en/catalog/os/nintendoswitch/platforms/nintendo', checked: CHECKED },
  { countries: ['BR'], currency: 'BRL', amounts: [], digitalOnly: [30, 50, 100, 150, 250, 300, 400, 500], source: 'https://en-americas-support.nintendo.com/app/answers/detail/a_id/53942', checked: CHECKED },
  { countries: ['GB'], currency: 'GBP', amounts: [15, 25, 50, 75, 100], source: 'https://www.nintendo.com/en-gb/Wii-U/Download-Content/How-to-buy-games/Nintendo-eShop-Cards/Nintendo-eShop-Cards-941778.html', checked: CHECKED },
  { countries: ['DE', 'FR', 'ES', 'IT', 'NL', 'PT', 'FI'], currency: 'EUR', amounts: [15, 25, 50, 75, 100], source: 'https://www.galaxus.de/en/s1/product/nintendo-eshop-card-25-eur-digital-gift-cards-37750835', checked: CHECKED },
  { countries: ['CH'], currency: 'CHF', amounts: [20, 35, 75], digitalOnly: [110, 150], source: 'https://www.digitec.ch/en/s1/product/nintendo-eshop-110-chf-digital-gift-cards-18225512', checked: CHECKED },
  { countries: ['NO'], currency: 'NOK', amounts: [150, 250, 500, 750, 1000], source: 'https://startselect.com/no-en/nintendo-eshop-gift-card-150-nok/47492', checked: CHECKED },
  { countries: ['SE'], currency: 'SEK', amounts: [150, 250, 500, 750, 1000], source: 'https://startselect.com/se-sv/nintendo-eshop-card', checked: CHECKED },
  { countries: ['DK'], currency: 'DKK', amounts: [150, 250, 500, 750, 1000], source: 'https://startselect.com/dk-en/nintendo-eshop-gift-card-150-dkk/47495', checked: CHECKED },
  { countries: ['PL'], currency: 'PLN', amounts: [70, 120, 250, 370, 500], source: 'https://mediamarkt.pl/pl/product/_e-kod-kod-aktywacyjny-nintendo-eshop-card-70-pln-1454038.html', checked: CHECKED },
  { countries: ['AU'], currency: 'AUD', amounts: [15, 30, 60, 100], source: 'https://www.nintendo.com/au/nintendo-eshop/how-to-download-nintendo-switch-games-from-nintendo-eshop', checked: CHECKED },
  { countries: ['JP'], currency: 'JPY', amounts: [1500, 3000, 5000, 9000], source: 'https://www.nintendo.com/jp/software/howtodl/prepaidcard/', checked: CHECKED },
  { countries: ['KR'], currency: 'KRW', amounts: [10000, 20000, 50000], source: 'https://support.nintendo.com/kr/switch/eshop/howtodl/prepaidcard/index.html', checked: CHECKED },
];

export function cardsFor(country: string): CardRange | undefined {
  return ESHOP_CARDS.find((c) => c.countries.includes(country));
}

/** Every value for a country, smallest first, marking digital-only ones. */
export function cardValues(range: CardRange): { amount: number; digitalOnly: boolean }[] {
  const digital = new Set(range.digitalOnly ?? []);
  return [...new Set([...range.amounts, ...digital])].sort((a, b) => a - b).map((amount) => ({ amount, digitalOnly: digital.has(amount) && !range.amounts.includes(amount) }));
}

/** Countries we can show cards for, in the usual region order. */
export const CARD_COUNTRIES: Region[] = SWITCH_REGIONS.filter((r) => cardsFor(r.code));

/**
 * Eneba is a marketplace where other sellers list codes, usually below face
 * value. We only link to it: their terms don't allow collecting their
 * prices automatically.
 *
 * Eneba's region filter names, as its store page uses them (checked
 * 6 Nov 2026). Euro cards are sold as "Europe" or for one country. Eneba
 * doesn't sell Korean cards.
 */
const ENEBA_REGIONS: Record<string, string[]> = {
  US: ['united_states', 'north_america'],
  CA: ['canada'],
  MX: ['mexico'],
  BR: ['brazil'],
  GB: ['united_kingdom'],
  DE: ['europe', 'germany'],
  FR: ['europe', 'france'],
  ES: ['europe', 'spain'],
  IT: ['europe', 'italy'],
  NL: ['europe', 'netherlands'],
  PT: ['europe', 'portugal'],
  FI: ['europe', 'finland'],
  CH: ['switzerland'],
  NO: ['norway'],
  SE: ['sweden'],
  DK: ['denmark'],
  PL: ['poland'],
  AU: ['australia'],
  JP: ['japan'],
};

export const ENEBA_STORE = 'https://www.eneba.com/store/gift-cards';

function enebaUrl(country: string, text: string): string | undefined {
  const regions = ENEBA_REGIONS[country];
  if (!regions) return undefined;
  const params = ['drms[]=nintendo', ...regions.map((r) => `regions[]=${r}`), 'sortBy=PRICE_ASC', `text=${encodeURIComponent(text)}`];
  return `${ENEBA_STORE}?${params.join('&')}`;
}

/** Every Nintendo eShop card Eneba sells for one country, cheapest first. */
export function enebaCountryUrl(country: string): string | undefined {
  return enebaUrl(country, 'Nintendo eShop');
}

/** Eneba's listing for one card value in one country. */
export function enebaCardUrl(country: string, amount: number, currency: string): string | undefined {
  return enebaUrl(country, `Nintendo eShop ${amount} ${currency}`);
}
