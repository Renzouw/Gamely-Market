import { STEAM_REGIONS, SWITCH_REGIONS, steamStoreCountry } from '@shared/regions';
import { americasEnabled } from '../config';
import { all, get, run, type Db } from '../db';
import { fetchCountryPrices } from '../sources/nintendo/prices';
import { detectSteamCurrency, fetchSteamItems, fetchSteamPrices } from '../sources/steam';
import {
  applyPrice,
  getGames,
  GROUPS,
  nsuidsForGames,
  refreshSaleFlags,
  removePrice,
  sourceError,
  sourceOk,
  tx,
  upsertGame,
  type Group,
  type PriceChange,
} from '../store';

export function switchCountries(): string[] {
  return SWITCH_REGIONS.filter((r) => r.group !== 'americas' || americasEnabled()).map((r) => r.code);
}

/**
 * Re-price Switch games in every country. A country that fails is skipped
 * and logged; its old prices stay as they were (and age into "stale")
 * rather than being wiped by an outage.
 */
export async function refreshSwitchPrices(db: Db, gameIds: string[], countries = switchCountries()): Promise<PriceChange[]> {
  const nsuids = nsuidsForGames(db, gameIds);
  const changes: PriceChange[] = [];
  const touched = new Set<string>();
  let failures = 0;
  let ok = 0;

  const reverseByGroup = new Map<Group, Map<string, string>>();
  for (const grp of GROUPS) {
    const reverse = new Map<string, string>();
    nsuids.forEach((m, gameId) => m[grp] && reverse.set(m[grp]!, gameId));
    reverseByGroup.set(grp, reverse);
  }
  // Fetch every country at once (the per-store queue keeps it polite), then
  // apply everything in one transaction so readers never see half a refresh.
  const regions = SWITCH_REGIONS.filter((r) => countries.includes(r.code) && reverseByGroup.get(r.group as Group)!.size);
  const results = await Promise.all(
    regions.map((region) =>
      fetchCountryPrices(region.code, [...reverseByGroup.get(region.group as Group)!.keys()]).then(
        (res) => ({ region, res }),
        (e: unknown) => ({ region, error: e }),
      ),
    ),
  );
  const now = Date.now();
  tx(db, () => {
    for (const r of results) {
      if ('error' in r) {
        failures++;
        sourceError(db, 'nintendo-prices', new Error(`${r.region.code}: ${r.error instanceof Error ? r.error.message : r.error}`));
        continue;
      }
      ok++;
      const reverse = reverseByGroup.get(r.region.group as Group)!;
      r.res.prices.forEach((price, nsuid) => {
        const gameId = reverse.get(nsuid);
        if (!gameId) return;
        touched.add(gameId);
        const c = applyPrice(db, gameId, price, now);
        if (c) changes.push(c);
      });
      r.res.gone.forEach((nsuid) => {
        const gameId = reverse.get(nsuid);
        if (!gameId) return;
        touched.add(gameId);
        const c = removePrice(db, gameId, r.region.code, now);
        if (c) changes.push(c);
      });
    }
  });
  if (ok) sourceOk(db, 'nintendo-prices', touched.size);
  refreshSaleFlags(db, [...touched]);
  if (failures && !ok) throw new Error('Nintendo price endpoint unreachable');
  return changes;
}

/* -------------------------------- Steam -------------------------------- */

const DAY = 86400_000;

/** Steam's currency per country, confirmed against appdetails at most once a day. */
export async function steamCurrency(db: Db, country: string): Promise<string> {
  const row = get<{ currency: string; checked_at: number }>(db, 'SELECT currency, checked_at FROM steam_currency WHERE country = ?', country);
  if (row && Date.now() - row.checked_at < DAY) return row.currency;
  const fallback = STEAM_REGIONS.find((r) => r.code === country)?.currency ?? row?.currency ?? 'USD';
  try {
    const detected = await detectSteamCurrency(country);
    const currency = detected ?? fallback;
    run(db, 'INSERT OR REPLACE INTO steam_currency (country, currency, checked_at) VALUES (?, ?, ?)', country, currency, Date.now());
    return currency;
  } catch {
    return row?.currency ?? fallback;
  }
}

export function steamCountriesInUse(db: Db): string[] {
  const set = new Set(['US', 'GB', 'DE', 'CA', 'AU', 'JP', 'BR', 'MX', 'AR', 'TR', 'IN', 'PL']);
  for (const r of all<{ steam_regions: string; home_region: string }>(db, 'SELECT steam_regions, home_region FROM devices')) {
    for (const c of JSON.parse(r.steam_regions) as string[]) set.add(c);
    // Alerts and deals use the store this person buys in, so it must always be priced
    set.add(steamStoreCountry(r.home_region).code);
  }
  return [...set].filter((c) => STEAM_REGIONS.some((r) => r.code === c));
}

export async function refreshSteamPrices(db: Db, gameIds: string[], countries = steamCountriesInUse(db)): Promise<PriceChange[]> {
  const games = getGames(db, gameIds).filter((g) => g.steam_app_id);
  const byApp = new Map(games.map((g) => [g.steam_app_id!, g.id]));
  if (!byApp.size) return [];
  const changes: PriceChange[] = [];
  let ok = 0;
  let metaDone = false;

  for (const country of countries) {
    const currency = await steamCurrency(db, country);
    try {
      let prices: Map<number, { price?: import('@shared/types').RegionPrice; name?: string; publisher?: string; releaseDate?: string }>;
      try {
        prices = await fetchSteamItems([...byApp.keys()], country, currency);
      } catch {
        // Fall back to appdetails, which is slower but independent
        const pd = await fetchSteamPrices([...byApp.keys()], country);
        prices = new Map([...pd].map(([k, v]) => [k, { price: v }]));
      }
      const now = Date.now();
      tx(db, () => {
        prices.forEach((info, appId) => {
          const gameId = byApp.get(appId);
          if (!gameId) return;
          if (!metaDone && (info.publisher || info.releaseDate)) {
            const g = games.find((x) => x.id === gameId)!;
            upsertGame(db, { id: gameId, platform: 'steam', title: info.name ?? g.title, publisher: info.publisher, releaseDate: info.releaseDate, steamAppId: appId });
          }
          if (info.price) {
            const c = applyPrice(db, gameId, info.price, now);
            if (c) changes.push(c);
          }
        });
      });
      metaDone = true;
      ok++;
    } catch (e) {
      sourceError(db, 'steam-prices', new Error(`${country}: ${e instanceof Error ? e.message : e}`));
    }
  }
  if (ok) sourceOk(db, 'steam-prices', byApp.size);
  refreshSaleFlags(db, [...byApp.values()]);
  return changes;
}

/**
 * One price refresh at a time. Alert planning rebuilds "before" from the
 * database, so two refreshes interleaving would each see the other's
 * changes as already there and miss alerts.
 */
let lock: Promise<unknown> = Promise.resolve();
export function withPriceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

/** Re-price any mix of games, routing each to its store. Call inside withPriceLock. */
export async function refreshGames(db: Db, gameIds: string[]): Promise<PriceChange[]> {
  const steam = gameIds.filter((id) => id.startsWith('steam:'));
  const sw = gameIds.filter((id) => id.startsWith('sw:'));
  const [a, b] = await Promise.all([
    sw.length ? refreshSwitchPrices(db, sw).catch(() => [] as PriceChange[]) : [],
    steam.length ? refreshSteamPrices(db, steam).catch(() => [] as PriceChange[]) : [],
  ]);
  return [...a, ...b];
}
