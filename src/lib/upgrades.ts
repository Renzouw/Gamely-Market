import type { ApiUpgrade, ApiUpgradeCountry } from '@shared/api';
import { formatMoney, formatWhole } from '@shared/pricing';
import { regionLabel } from '@shared/regions';

/** Whole amounts from 100 up ("₱3,490", not "₱3,490.00"): long prices made the rows wrap and cut off */
export const fmt = (n: number, currency: string) => (Math.abs(n) >= 100 ? formatWhole(n, currency) : formatMoney(n, currency));
/** A difference (a saving, "by ₱29"): whole from 10 up, where cents only add noise */
const diff = (n: number, currency: string) => (Math.abs(n) >= 10 ? formatWhole(n, currency) : formatMoney(n, currency));

const place = (country: string) => {
  const r = regionLabel(country);
  return `${r.flag} ${r.name}`;
};

export interface UpgradeSummary {
  /** The cheapest way to the Switch 2 Edition, in full */
  cheapest: string;
  /** The other route at its cheapest, for comparison */
  other?: string;
  /** The upgrade route in your own eShop, when it isn't already one of the lines above */
  home?: string;
  verdict: { text: string; tone: 'signal' | 'subtle' | 'muted'; detail?: string };
  /** The whole row, for screen readers */
  label: string;
}

/** "In your eShop 🇵🇭: ₱3,490 + ₱390 = ₱3,880, same as the Edition there" */
export function homeLineText(home: ApiUpgradeCountry, currency: string): string {
  const c = home.converted;
  const money = (mine: number | undefined, local: number) => (c && mine !== undefined ? fmt(mine, currency) : fmt(local, home.currency));
  const saving = c?.saving;
  const verdict =
    saving === undefined ? '' : saving >= 0.01 ? `, ${diff(saving, currency)} less than the Edition there` : saving <= -0.01 ? `, ${diff(-saving, currency)} more than the Edition there` : ', same as the Edition there';
  return `In your eShop ${regionLabel(home.country).flag}: ${money(c?.base, home.base)} + ${money(c?.pack, home.pack)} = ${money(c?.combo, home.base + home.pack)}${verdict}`;
}

/**
 * What a row in Directory > Upgrade packs says. It answers "what's the cheapest way
 * to get this Switch 2 Edition?" across every region compared: bought whole, or as
 * the Switch game plus its upgrade pack (from one eShop). "Save" only appears when
 * the upgrade route beats the cheapest Edition anywhere.
 */
export function upgradeSummary(item: ApiUpgrade, currency: string, title: string): UpgradeSummary {
  const e = item.cheapestEdition;
  const u = item.cheapestUpgrade;
  const uc = u?.converted;
  const s = item.saving;
  const upgradeLine = (with_ = true) =>
    u && uc
      ? with_
        ? `Switch game ${fmt(uc.base, currency)}${u.baseSale ? ' (sale)' : ''} + upgrade ${fmt(uc.pack, currency)}${u.packSale ? ' (sale)' : ''} = ${fmt(uc.combo, currency)} in ${place(u.country)}`
        : `Switch game + upgrade from ${fmt(uc.combo, currency)} in ${place(u.country)}`
      : undefined;
  const editionLine = (lead: boolean) => (e ? `${lead ? 'Switch 2 Edition' : 'Edition from'} ${fmt(e.converted, currency)}${e.sale ? ' (sale)' : ''} in ${place(e.country)}` : undefined);

  let out: Omit<UpgradeSummary, 'home' | 'label'>;
  if (s !== undefined && s >= 0.01) {
    out = {
      cheapest: upgradeLine()!,
      other: editionLine(false),
      verdict: { text: `Save ${diff(s, currency)}`, tone: 'signal', detail: e && e.converted > 0 ? `−${Math.round((s / e.converted) * 100)}%` : undefined },
    };
  } else if (e) {
    out = {
      cheapest: editionLine(true)!,
      other: upgradeLine(false),
      verdict:
        s === undefined
          ? { text: 'Edition', tone: 'subtle' }
          : s > -0.01
            ? { text: 'Same price', tone: 'subtle' }
            : { text: 'Edition', tone: 'subtle', detail: `${diff(-s, currency)} cheaper` },
    };
  } else if (upgradeLine()) {
    out = { cheapest: upgradeLine()!, verdict: { text: 'Only as upgrade', tone: 'muted' } };
  } else {
    out = { cheapest: 'No prices in your currency yet', verdict: { text: '', tone: 'muted' } };
  }

  // Your own eShop's upgrade route, unless the line above already is it
  const home = item.home && item.home.country !== u?.country ? homeLineText(item.home, currency) : undefined;
  const label = [title, `Cheapest: ${out.cheapest}`, out.other, out.verdict.text, out.verdict.detail, home].filter(Boolean).join('. ');
  return { ...out, home, label };
}

/**
 * For someone who already owns the Switch game: only the upgrade's price matters, and it
 * has to come from the eShop their game is from. Their own eShop when it sells the pack,
 * otherwise the cheapest anywhere with that caveat.
 */
export function ownedLine(item: ApiUpgrade, currency: string): string | undefined {
  const home = item.home?.converted ? item.home : undefined;
  if (home) return `The upgrade is ${home.converted!.pack === 0 ? 'free' : fmt(home.converted!.pack, currency)} in your eShop (${regionLabel(home.country).flag} ${regionLabel(home.country).name}).`;
  const cheapest = item.countries.filter((c) => c.converted).reduce<ApiUpgradeCountry | undefined>((a, b) => (!a || b.converted!.pack < a.converted!.pack ? b : a), undefined);
  if (!cheapest) return undefined;
  const price = cheapest.converted!.pack === 0 ? 'free' : `from ${fmt(cheapest.converted!.pack, currency)}`;
  return `The upgrade is ${price} in ${place(cheapest.country)}. It has to come from the same eShop as your Switch game.`;
}
