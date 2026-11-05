const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const MIN = 60_000;

/**
 * Every upstream URL can be overridden. Production uses the defaults; tests
 * and local QA point them at a fixture server.
 */
export const config = {
  port: num(env.PORT, 8787),
  dbPath: env.DB_PATH ?? './data/gamely.db',
  /** Set to "0" to run only the API (useful for tests). */
  runJobs: env.RUN_JOBS !== '0',

  upstream: {
    nintendoPrice: env.UPSTREAM_NINTENDO_PRICE ?? 'https://api.ec.nintendo.com/v1/price',
    nintendoEuSearch: env.UPSTREAM_NINTENDO_EU ?? 'https://searching.nintendo-europe.com/en/select',
    nintendoJpSearch: env.UPSTREAM_NINTENDO_JP ?? 'https://search.nintendo.jp/nintendo_soft/search.json',
    steamStore: env.UPSTREAM_STEAM_STORE ?? 'https://store.steampowered.com',
    steamApi: env.UPSTREAM_STEAM_API ?? 'https://api.steampowered.com',
    /** European Central Bank reference rates, served by Frankfurter */
    fxPrimary: env.UPSTREAM_FX_PRIMARY ?? 'https://api.frankfurter.dev/v1/latest',
    /** Only used for currencies the ECB doesn't publish (ARS, CLP, COP, PEN, ...) */
    fxFallback: env.UPSTREAM_FX_FALLBACK ?? 'https://open.er-api.com/v6/latest/USD',
    expoPush: env.UPSTREAM_EXPO_PUSH ?? 'https://exp.host/--/api/v2/push',
  },

  /** Optional Americas catalog. See README. */
  naSearch: {
    appId: env.NA_SEARCH_APP_ID ?? '',
    apiKey: env.NA_SEARCH_API_KEY ?? '',
    index: env.NA_SEARCH_INDEX || 'store_game_en_us',
  },

  /** Optional. Turns on Expo's enhanced push security. */
  expoAccessToken: env.EXPO_ACCESS_TOKEN ?? '',

  /** How often each job runs. Defaults are tuned to stay polite to the stores. */
  schedule: {
    fx: num(env.EVERY_FX_MIN, 360) * MIN,
    hotPrices: num(env.EVERY_HOT_MIN, 10) * MIN, // watched games and sales ending soon
    dealDiscovery: num(env.EVERY_DEALS_MIN, 20) * MIN,
    salePrices: num(env.EVERY_SALE_MIN, 30) * MIN, // everything currently discounted
    catalog: num(env.EVERY_CATALOG_MIN, 720) * MIN,
    fullSweep: num(env.EVERY_SWEEP_MIN, 1440) * MIN, // every game, every region
    endingSoon: num(env.EVERY_ENDING_MIN, 60) * MIN,
    dispatch: num(env.EVERY_DISPATCH_SEC, 30) * 1000,
    receipts: num(env.EVERY_RECEIPTS_MIN, 15) * MIN,
  },

  /** Prices older than this are flagged as stale in API responses */
  staleAfterMs: num(env.STALE_AFTER_MIN, 36 * 60) * MIN,
  /** Game pages refresh on demand when their prices are older than this */
  refreshOnViewAfterMs: num(env.REFRESH_ON_VIEW_MIN, 180) * MIN,
};

export const americasEnabled = () => Boolean(config.naSearch.appId && config.naSearch.apiKey);
