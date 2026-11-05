import { useMemo } from 'react';
import { summarize, type PriceSummary } from '../domain/pricing';
import type { Game, RegionPrice } from '../domain/types';
import { steamStoreCountry } from '../domain/regions';
import { useFx, usePriceContext } from './queries';

/**
 * Best price, home price and savings for one game, in the user's currency.
 * For Steam, "home" is the store country your account would buy in.
 */
export function usePriceSummary(game: Pick<Game, 'platform'>, prices: RegionPrice[]): PriceSummary & { homeCurrency: string } {
  const { homeCurrency, homeRegion } = usePriceContext();
  const fx = useFx().data;
  return useMemo(() => {
    const home = game.platform === 'steam' ? steamStoreCountry(homeRegion).code : homeRegion;
    return { ...summarize(prices, { homeCurrency, homeRegion: home, fx }), homeCurrency };
  }, [prices, homeCurrency, homeRegion, fx, game.platform]);
}
