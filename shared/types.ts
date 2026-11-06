export type Platform = 'switch2' | 'switch' | 'steam';

/** Nintendo eShops share game IDs (NSUIDs) inside these groups. */
export type ShopGroup = 'americas' | 'europe' | 'japan' | 'hongkong' | 'korea' | 'steam';

export interface Money {
  /** Price in major units, e.g. 59.99 */
  amount: number;
  /** ISO 4217 currency code as reported by the store */
  currency: string;
}

export interface RegionPrice {
  country: string; // ISO 3166 alpha-2
  regular: Money;
  /** Present only while a sale is running */
  sale?: Money;
  discountPercent: number;
  /** ISO date string, when the store reports one */
  saleEndsAt?: string;
}

/** A RegionPrice with conversion applied to the user's home currency. */
export interface ConvertedRegionPrice extends RegionPrice {
  current: Money;
  /** Current price converted to home currency, undefined when no FX rate */
  converted?: number;
  convertedRegular?: number;
}

/**
 * One game as shown in lists. IDs are platform-specific:
 * - Switch: per-group NSUIDs
 * - Steam: app id
 */
export interface Game {
  /** Stable key used for routing and the watchlist, e.g. "sw:Zelda Tears..." or "steam:1245620" */
  key: string;
  platform: Platform;
  title: string;
  image?: string;
  publisher?: string;
  releaseDate?: string;
  /** Switch only */
  nsuids?: Partial<Record<Exclude<ShopGroup, 'steam'>, string>>;
  /** Switch only, e.g. "HACPAAAAA". Helps match the same game across regions. */
  productCode?: string;
  /** Switch only: Nintendo's application ID, the same in every region */
  applicationId?: string;
  /** Steam only */
  steamAppId?: number;
  /** Price in the region the listing came from, if the listing source included one */
  listPrice?: RegionPrice;
  popularity?: number;
  storeUrl?: string;
}

export interface FxRates {
  base: string;
  /** units of currency per 1 base */
  rates: Record<string, number>;
  updatedAt: number;
}

export interface PricePoint {
  /** epoch ms */
  t: number;
  /** best price in home currency at that time */
  best: number;
  country: string;
}
