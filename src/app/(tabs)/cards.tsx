import * as Linking from 'expo-linking';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { CARD_COUNTRIES, cardsFor, cardValues, enebaSearchUrl } from '@shared/eshopCards';
import { convert, formatMoney } from '@shared/pricing';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button, Chip, EmptyState, Group, Sheet, SheetOption } from '../../components/ui';
import { useFx, usePrefs } from '../../hooks/queries';
import { GUTTER, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

/** Card values are whole amounts: "$50", not "$50.00". */
function cardLabel(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount);
  } catch {
    return formatMoney(amount, currency);
  }
}

/**
 * Official eShop card values for one country, in the user's currency, with a
 * link to Eneba's own listing for each card (marketplace prices are usually
 * lower; we don't collect them, Eneba's terms don't allow it).
 */
export default function CardsScreen() {
  const { c } = useTheme();
  const prefs = usePrefs();
  const fx = useFx().data;
  const [picked, setPicked] = useState<string>();
  const [open, setOpen] = useState(false);

  // Start on the home eShop, else the first region this person compares
  const country =
    CARD_COUNTRIES.find((r) => r.code === (picked ?? prefs.home)) ??
    CARD_COUNTRIES.find((r) => prefs.switchRegions.includes(r.code)) ??
    CARD_COUNTRIES[0];
  const range = country ? cardsFor(country.code) : undefined;

  if (!country || !range) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <ScreenHeader title="eShop cards" />
        <EmptyState title="No card values yet" body="We haven’t confirmed eShop card values for any country yet." />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 64 }}>
      <ScreenHeader title="eShop cards" subtitle={`Official card values, in ${prefs.currency}`} />
      <View style={styles.filters}>
        <Chip label={`${country.flag} ${country.name}`} active trailing="chevron-down" onPress={() => setOpen(true)} />
      </View>

      <Group
        title={`${country.name} eShop · ${range.currency}`}
        footer={[
          `Converted at today’s exchange rate. A card only works on an eShop account set to the country it was sold for, so check it’s a ${country.name} card before you buy.`,
          'Eneba is a marketplace where other sellers list codes, often below face value. Check the seller’s rating before you buy: marketplace codes sometimes stop working.',
        ].join('\n\n')}
      >
        {cardValues(range).map((v, i) => {
          const mine = convert(v.amount, range.currency, prefs.currency, fx);
          return (
            <View key={v.amount} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="priceM">{cardLabel(v.amount, range.currency)}</Text>
                <Text variant="footnote" tone="subtle">
                  {mine !== undefined && range.currency !== prefs.currency ? `About ${formatMoney(mine, prefs.currency)}` : range.currency === prefs.currency ? 'Your currency' : 'No exchange rate yet'}
                  {v.digitalOnly ? ' · digital code only' : ''}
                </Text>
              </View>
              <Button
                label="Eneba"
                icon="open-outline"
                variant="secondary"
                style={styles.eneba}
                onPress={() => Linking.openURL(enebaSearchUrl(v.amount, range.currency))}
                accessibilityLabel={`See ${cardLabel(v.amount, range.currency)} cards on Eneba`}
              />
            </View>
          );
        })}
      </Group>

      <Text variant="caption" tone="subtle" style={styles.note}>
        Card values checked {range.checked}, from Nintendo or a major retailer.
      </Text>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Show cards for">
        <ScrollView style={{ maxHeight: 440 }}>
          {CARD_COUNTRIES.map((r) => (
            <SheetOption
              key={r.code}
              label={`${r.flag}  ${r.name}`}
              detail={cardsFor(r.code)!.currency}
              selected={r.code === country.code}
              onPress={() => (setPicked(r.code), setOpen(false))}
            />
          ))}
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', paddingHorizontal: GUTTER, paddingTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  eneba: { height: 38, paddingHorizontal: space.md },
  note: { paddingHorizontal: GUTTER + space.xs, marginTop: space.md },
});
