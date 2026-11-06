import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { space, useTheme } from '../theme';
import { Chip, Sheet, SheetOption } from './ui';

export interface SortOption<T extends string> {
  value: T;
  label: string;
  detail: string;
}

/** The sort button at the start of a filter row, and the sheet it opens. Used by Deals and Directory. */
export function SortChip<T extends string>({ value, options, onChange, title }: { value: T; options: SortOption<T>[]; onChange: (v: T) => void; title: string }) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? options[0].label;
  return (
    <>
      <Chip label={label} trailing="chevron-down" onPress={() => setOpen(true)} accessibilityLabel={`${title}: ${label}`} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        {options.map((o) => (
          <SheetOption key={o.value} label={o.label} detail={o.detail} selected={value === o.value} onPress={() => (onChange(o.value), setOpen(false))} />
        ))}
      </Sheet>
    </>
  );
}

/** The thin divider between the sort/country chips and the filter chips. */
export function ChipDivider() {
  const { c } = useTheme();
  return <View style={[styles.divider, { backgroundColor: c.line }]} />;
}

const styles = StyleSheet.create({
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space.xs },
});
