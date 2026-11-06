import type { FxRates, Game, Platform, RegionPrice, ShopGroup } from './types';

/** Contract between the Gamely API and the app. */

export interface ApiPrice extends RegionPrice {
  /** When the store last confirmed this price (epoch ms) */
  checkedAt: number;
}

export interface ApiGame extends Game {
  onSale: boolean;
  maxDiscount: number;
  /** Soonest sale end across all regions */
  saleEndsAt?: string;
}

export interface ApiListItem {
  game: ApiGame;
  /** Only the regions the caller asked for */
  prices: ApiPrice[];
}

export interface ApiList {
  items: ApiListItem[];
  total: number;
  nextCursor?: string;
  /** Newest price check among the returned items */
  checkedAt?: number;
}

export type DealSort = 'popular' | 'discount' | 'cheapest' | 'ending' | 'newest';

export interface DealQuery {
  platform: Platform;
  sort: DealSort;
  home: string;
  currency: string;
  regions: string[];
  minDiscount?: number;
  maxPrice?: number;
  /** Only games at least this much cheaper abroad than at home (0.15 = 15%) */
  abroad?: number;
  /** Switch only: just this one eShop. Deals on sale there, priced there, regardless of `regions`. */
  country?: string;
  cursor?: string;
  limit?: number;
}

export type DirectorySort = 'popular' | 'cheapest' | 'discount' | 'newest' | 'title';

/** Sort and filters for the Directory. Prices use the same rules as deals: the best price across `regions`, converted. */
export interface DirectoryOptions {
  sort?: DirectorySort;
  /** Only games discounted in at least one of the regions */
  onSale?: boolean;
  minDiscount?: number;
  /** In the caller's currency */
  maxPrice?: number;
  /** Only games at least this much cheaper abroad than at home (0.15 = 15%) */
  abroad?: number;
  /** Switch only: just this one eShop, and only games it sells */
  country?: string;
}

export interface ApiLow {
  country: string;
  currency: string;
  price: number;
  at: number;
}

export interface HistoryPoint {
  /** Start of day, epoch ms */
  t: number;
  /** Best price that day across the caller's regions, in the caller's currency at today's rates */
  best: number;
  country: string;
}

export interface ApiGameDetail {
  game: ApiGame;
  prices: ApiPrice[];
  lows: ApiLow[];
  history: HistoryPoint[];
  /** Lowest price ever recorded across the caller's regions, caller's currency at today's rates */
  lowest?: { price: number; country: string; at: number };
  /** When we started tracking this game */
  trackedSince: number;
  /** Regional catalogs we couldn't confidently match this game in */
  unmatched: Exclude<ShopGroup, 'steam'>[];
  stale: boolean;
}

export interface ApiFx extends FxRates {
  /** "ecb" = European Central Bank reference rate, "market" = market feed */
  sources: Record<string, 'ecb' | 'market'>;
  asOf: string;
}

export interface SourceHealth {
  source: string;
  label: string;
  lastOk?: number;
  lastError?: string;
  lastErrorAt?: number;
  healthy: boolean;
}

export interface ApiStatus {
  sources: SourceHealth[];
  americasEnabled: boolean;
  now: number;
}

export interface AlertPrefs {
  /** Went on sale in one of your regions */
  sale: boolean;
  /** Any further price drop */
  drop: boolean;
  /** Reached your target price */
  target: boolean;
  /** Lowest price ever recorded */
  low: boolean;
  /** Sale ends within 24 hours */
  ending: boolean;
}

export const DEFAULT_ALERTS: AlertPrefs = { sale: true, drop: false, target: true, low: true, ending: true };

export interface WatchInput {
  target?: number | null;
  alerts?: Partial<AlertPrefs>;
}

export interface ApiWatch {
  game: ApiGame;
  target?: number;
  alerts: AlertPrefs;
  createdAt: number;
  prices: ApiPrice[];
  lowest?: { price: number; country: string; at: number };
}

export interface DeviceSettings {
  pushToken?: string | null;
  os?: string;
  homeRegion: string;
  currency: string;
  switchRegions: string[];
  steamRegions: string[];
  tz: string;
  quietStart?: number | null;
  quietEnd?: number | null;
  alertsEnabled: boolean;
  eventAlerts?: EventPrefs;
}

/** Alerts that aren't about a watched game: store-wide sales and big deals. */
export interface EventPrefs {
  /** Steam or the eShop starts a major sale */
  storeSales: boolean;
  /** Popular games at a deep discount, sent as a digest */
  bigDeals: boolean;
  platforms: ('switch2' | 'switch' | 'steam')[];
  /** Minimum discount for a big deal, in percent */
  minDiscount: number;
}

export const DEFAULT_EVENT_ALERTS: EventPrefs = { storeSales: true, bigDeals: true, platforms: ['switch2', 'switch', 'steam'], minDiscount: 50 };

/** A store-wide sale we detected from the number of discounted games. */
export interface ApiSaleEvent {
  id: number;
  platform: Platform;
  startedAt: number;
  /** Games discounted right now, as reported by the store */
  count: number;
  /** A normal day's count before the sale started */
  baseline: number;
}

export interface DeviceRegistration {
  id: string;
  secret: string;
}

export type AlertKind = 'sale' | 'drop' | 'target' | 'low' | 'ending' | 'digest' | 'event' | 'deals';

export interface ApiActivity {
  id: number;
  gameId?: string;
  kind: AlertKind;
  title: string;
  body: string;
  createdAt: number;
  image?: string;
}
