import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SWITCH_REGIONS, type Region } from '@shared/regions';
import { directSwitchCountries } from '../direct';
import { useDataMode, usePrefs, useStatus } from '../hooks/queries';
import { Chip, Sheet, SheetOption } from './ui';

/**
 * The eShops someone can look at one at a time: the ones they compare (plus
 * home) that we can price right now. Phone-only mode reaches only Europe and
 * Oceania; the Americas need the server's catalog, which may be off.
 */
export function useCountryOptions(): Region[] {
  const prefs = usePrefs();
  const mode = useDataMode();
  const americas = useStatus().data?.americasEnabled === true;
  const codes = new Set(
    mode === 'direct'
      ? directSwitchCountries({ home: prefs.home, currency: prefs.currency, switchRegions: prefs.switchRegions, steamRegions: prefs.steamRegions })
      : [...prefs.switchRegions, prefs.home],
  );
  return SWITCH_REGIONS.filter((r) => codes.has(r.code) && (mode === 'direct' || r.group !== 'americas' || americas));
}

/** The picked country, or undefined when it isn't available any more (Settings or data mode changed). */
export function useCountry(value: string | undefined): Region | undefined {
  const options = useCountryOptions();
  return value ? options.find((r) => r.code === value) : undefined;
}

/** A filter chip that narrows a list to one eShop, without changing Settings. */
export function CountryChip({ value, onChange }: { value: string | undefined; onChange: (code: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const options = useCountryOptions();
  const selected = useCountry(value);
  const pick = (code: string | undefined) => (onChange(code), setOpen(false));
  return (
    <>
      <Chip label={selected ? `${selected.flag} ${selected.name}` : 'All regions'} active={!!selected} trailing="chevron-down" onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Show one eShop">
        <ScrollView style={{ maxHeight: 440 }}>
          <SheetOption label="All your regions" detail="The best price across every eShop you compare" selected={!selected} onPress={() => pick(undefined)} />
          {options.map((r) => (
            <SheetOption key={r.code} label={`${r.flag}  ${r.name}`} detail={r.currency} selected={selected?.code === r.code} onPress={() => pick(r.code)} />
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}
