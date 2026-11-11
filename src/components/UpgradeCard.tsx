import { router } from 'expo-router';
import type { ApiUpgrade } from '@shared/api';
import { withoutEdition } from '@shared/listing';
import { ownedLine, upgradeSummary } from '../lib/upgrades';
import { Group, Row } from './ui';

/**
 * On the page of a Switch game, its Switch 2 Edition or the upgrade pack between them:
 * the cheapest way to the Edition (whole, or the Switch game plus the upgrade from one
 * eShop), what the upgrade costs for someone who already owns the game, and the other two.
 */
export function UpgradeCard({ upgrade, currency, current }: { upgrade: ApiUpgrade; currency: string; current: string }) {
  const s = upgradeSummary(upgrade, currency, withoutEdition(upgrade.edition.title));
  const owned = ownedLine(upgrade, currency);
  const open = (key: string) => router.push({ pathname: '/game/[key]', params: { key } });
  const links = [
    { key: upgrade.base.key, label: 'The Switch game' },
    { key: upgrade.edition.key, label: 'The Switch 2 Edition' },
    { key: upgrade.pack.key, label: 'The upgrade pack' },
  ].filter((l) => l.key !== current);
  return (
    <Group title="Switch 2 Edition: two ways to get it" footer="An upgrade pack only works with the Switch game from the same eShop.">
      <Row first label="Cheapest way" detail={s.cheapest} value={[s.verdict.text, s.verdict.detail].filter(Boolean).join(', ')} />
      {s.other ? <Row label="The other way" detail={s.other} /> : null}
      {owned ? <Row label="Already own the Switch game?" detail={owned} /> : null}
      {s.home ? <Row label="Switch game + upgrade at home" detail={s.home.replace(/^In your eShop [^:]*: /, '')} /> : null}
      {links.map((l) => (
        <Row key={l.key} label={l.label} onPress={() => open(l.key)} accessibilityHint="Opens its page" />
      ))}
    </Group>
  );
}
