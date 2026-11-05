import type { Game, RegionPrice } from '../domain/types';
import { steamStoreCountry } from '../domain/regions';
import { priceSwitchGames, resolveAllRegions } from './nintendo';
import { fetchSteamRegionalPrices } from './steam';

export interface PriceContext {
  homeRegion: string;
  switchRegions: string[];
  steamRegions: string[];
}

export function switchCountries(ctx: PriceContext): string[] {
  return ctx.switchRegions.includes(ctx.homeRegion) ? ctx.switchRegions : [...ctx.switchRegions, ctx.homeRegion];
}

export function steamCountries(ctx: PriceContext): string[] {
  const store = steamStoreCountry(ctx.homeRegion).code;
  return ctx.steamRegions.includes(store) ? ctx.steamRegions : [store, ...ctx.steamRegions];
}

/** Every regional price for one game, resolving missing regional IDs first. */
export async function regionalPricesFor(game: Game, ctx: PriceContext): Promise<{ game: Game; prices: RegionPrice[] }> {
  if (game.platform === 'steam') {
    if (!game.steamAppId) return { game, prices: [] };
    return { game, prices: await fetchSteamRegionalPrices(game.steamAppId, steamCountries(ctx)) };
  }
  const resolved = await resolveAllRegions(game);
  const map = await priceSwitchGames([resolved], switchCountries(ctx));
  return { game: resolved, prices: map.get(resolved.key) ?? [] };
}
