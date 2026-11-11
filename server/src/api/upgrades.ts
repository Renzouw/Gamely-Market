import type { ApiFx, ApiUpgrade, ApiUpgradeCountry, ApiUpgradeList } from '@shared/api';
import { convert } from '@shared/pricing';
import { all, type Db } from '../db';
import { getGames, nsuidsForGames, pricesFor, rowToGame, rowToPrice, type PriceRow } from '../store';
import { effectiveRegions } from './listings';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Switch 2 Editions with an upgrade pack, and what each route costs: the
 * Edition, or the Switch game plus the upgrade. An upgrade pack only works
 * with a game bought from the same eShop, so both routes are priced within
 * one country at a time. Upgrade packs have Europe's IDs, so the countries
 * that share Europe's catalog (Europe, Oceania, South Africa) are the ones
 * with all three prices.
 */
export function listUpgrades(db: Db, q: { home: string; currency: string; regions: string[] }, fx: ApiFx | undefined, now = Date.now()): ApiUpgradeList {
  const { regions } = effectiveRegions('switch', q.home, q.regions);
  const rows = all<{ edition_id: string; pack_id: string; base_id: string | null }>(
    db,
    `SELECT u.edition_id, u.pack_id,
       (SELECT b.id FROM games b
         WHERE b.platform = 'switch' AND b.app_id = e.app_id AND b.id NOT LIKE 'sw:eu:7005%'
         ORDER BY b.rank IS NULL, b.rank LIMIT 1) AS base_id
     FROM upgrades u JOIN games e ON e.id = u.edition_id
     WHERE e.app_id IS NOT NULL`,
  ).filter((r): r is { edition_id: string; pack_id: string; base_id: string } => !!r.base_id);
  if (!rows.length) return { items: [] };

  const ids = [...new Set(rows.flatMap((r) => [r.edition_id, r.pack_id, r.base_id]))];
  const games = new Map(getGames(db, ids).map((g) => [g.id, g]));
  const prices = pricesFor(db, ids, regions);
  const nsuids = nsuidsForGames(db, ids);
  const byCountry = (id: string) => new Map((prices.get(id) ?? []).map((p: PriceRow) => [p.country, rowToPrice(p, now)]));
  const conv = (n: number, from: string) => {
    const v = convert(n, from, q.currency, fx);
    return v === undefined ? undefined : round(v);
  };

  const items: ApiUpgrade[] = [];
  for (const r of rows) {
    const [edition, pack, base] = [games.get(r.edition_id), games.get(r.pack_id), games.get(r.base_id)];
    if (!edition || !pack || !base) continue;
    const ed = byCountry(r.edition_id);
    const pk = byCountry(r.pack_id);
    const bs = byCountry(r.base_id);
    const countries: ApiUpgradeCountry[] = [];
    for (const [country, p] of pk) {
      const b = bs.get(country);
      if (!b || b.regular.currency !== p.regular.currency) continue;
      const e = ed.get(country);
      const currency = p.regular.currency;
      const basePrice = (b.sale ?? b.regular).amount;
      const packPrice = (p.sale ?? p.regular).amount;
      const editionPrice = e && e.regular.currency === currency ? (e.sale ?? e.regular).amount : undefined;
      const combo = basePrice + packPrice;
      const c = { base: conv(basePrice, currency), pack: conv(packPrice, currency), combo: conv(combo, currency), edition: editionPrice === undefined ? undefined : conv(editionPrice, currency) };
      countries.push({
        country,
        currency,
        base: basePrice,
        pack: packPrice,
        edition: editionPrice,
        baseSale: !!b.sale,
        packSale: !!p.sale,
        editionSale: !!e?.sale,
        converted:
          c.base === undefined || c.pack === undefined || c.combo === undefined
            ? undefined
            : { base: c.base, pack: c.pack, combo: c.combo, edition: c.edition, saving: c.edition === undefined ? undefined : round(c.edition - c.combo) },
      });
    }
    if (!countries.length) continue;
    const priced = countries.filter((c) => c.converted);
    const withSaving = priced.filter((c) => c.converted!.saving !== undefined);
    const best = withSaving.length
      ? withSaving.reduce((a, b) => (b.converted!.saving! > a.converted!.saving! ? b : a))
      : priced.length
        ? priced.reduce((a, b) => (b.converted!.combo < a.converted!.combo ? b : a))
        : undefined;
    items.push({
      edition: rowToGame(edition, nsuids.get(edition.id)),
      base: rowToGame(base, nsuids.get(base.id)),
      pack: rowToGame(pack, nsuids.get(pack.id)),
      best,
      countries,
    });
  }
  // Biggest saving first; then the cheapest route where the Edition isn't sold whole
  const saving = (i: ApiUpgrade) => i.best?.converted?.saving ?? -Infinity;
  items.sort((a, b) => saving(b) - saving(a) || (a.best?.converted?.combo ?? Infinity) - (b.best?.converted?.combo ?? Infinity));
  return { items };
}
