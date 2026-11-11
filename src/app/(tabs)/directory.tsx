import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiListItem, DirectoryOptions, DirectorySort } from '@shared/api';
import { formatMoney } from '@shared/pricing';
import { errorText } from '../../api/client';
import { CountryChip, useCountry, useHomePriced } from '../../components/CountryFilter';
import { GameRow } from '../../components/GameRow';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ChipDivider, SortChip, type SortOption } from '../../components/SortChip';
import { Chip, EmptyState, PlatformTabs, RowSkeleton } from '../../components/ui';
import { UpgradeList } from '../../components/UpgradeList';
import { useDebounced } from '../../hooks/useDebounced';
import { useDirectory, usePrefs, type DirectoryPlatform } from '../../hooks/queries';
import { cheapLimit } from '../../lib/format';
import { font, GUTTER, platformMeta, radius, space, useTheme } from '../../theme';

const TABS: { value: DirectoryPlatform; label: string; dot?: string }[] = [
  { value: 'all-switch', label: 'All Switch' },
  { value: 'switch2', label: 'Switch 2', dot: platformMeta.switch2.dot },
  { value: 'switch', label: 'Switch', dot: platformMeta.switch.dot },
  { value: 'steam', label: 'Steam', dot: platformMeta.steam.dot },
];

const SORTS: SortOption<DirectorySort>[] = [
  { value: 'popular', label: 'Popular', detail: 'What people are buying' },
  { value: 'cheapest', label: 'Lowest price', detail: 'Cheapest in your currency, across your regions' },
  { value: 'discount', label: 'Biggest discount', detail: 'Deepest cuts first' },
  { value: 'newest', label: 'Newest releases', detail: 'Latest games first' },
  { value: 'title', label: 'A to Z', detail: 'By name' },
];

/** Whether the on-screen keyboard is up (web has no such events, so it counts as up while typing there) */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(RNPlatform.OS === 'web');
  useEffect(() => {
    if (RNPlatform.OS === 'web') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => (show.remove(), hide.remove());
  }, []);
  return open;
}

export default function DirectoryScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // While typing, the big title steps aside so more results fit above the keyboard
  const [focused, setFocused] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const typing = focused && keyboardOpen;
  const prefs = usePrefs();
  const [platform, setPlatform] = useState<DirectoryPlatform>('all-switch');
  const [text, setText] = useState('');
  const query = useDebounced(text);
  const isSteam = platform === 'steam';
  const [countryCode, setCountry] = useState<string>();
  const country = useCountry(isSteam ? undefined : countryCode);
  const canAbroad = useHomePriced() && !country;
  const [sort, setSort] = useState<DirectorySort>('popular');
  const [onSale, setOnSale] = useState(false);
  const [big, setBig] = useState(false);
  const [cheap, setCheap] = useState(false);
  const [abroad, setAbroad] = useState(false);
  // Its own list: Switch 2 Editions next to the Switch game + upgrade pack route
  const [upgrades, setUpgrades] = useState(false);
  const showUpgrades = upgrades && !isSteam;
  const limit = cheapLimit(prefs.currency);

  const options = useMemo<DirectoryOptions>(
    () => ({
      sort,
      onSale: onSale || undefined,
      minDiscount: big ? 50 : undefined,
      maxPrice: cheap ? limit : undefined,
      // Cheaper abroad compares with home, which doesn't apply to a single eShop
      abroad: abroad && canAbroad ? 0.15 : undefined,
      country: country?.code,
    }),
    [sort, onSale, big, cheap, abroad, limit, country, canAbroad],
  );
  // Paused while the Upgrade packs list is showing (it would fetch a list nobody sees)
  const q = useDirectory(platform, query, options, !(upgrades && !isSteam));
  const filtered = onSale || big || cheap || (abroad && canAbroad) || !!country;
  const clear = () => (setOnSale(false), setBig(false), setCheap(false), setAbroad(false), setCountry(undefined));

  const renderItem = useCallback(
    ({ item }: { item: ApiListItem }) => <GameRow game={item.game} prices={item.prices} ticker={!isSteam} showPlatform={platform === 'all-switch'} />,
    [isSteam, platform],
  );

  const count = q.total !== undefined ? `${q.total.toLocaleString()} ${q.total === 1 ? 'game' : 'games'}` : 'Games';
  const subtitle = isSteam
    ? 'Search the Steam store'
    : showUpgrades
      ? 'Switch 2 Editions, and what the Switch game plus upgrade costs'
      : country
      ? `${count} sold in the ${country.flag} ${country.name} eShop`
      : filtered && q.total !== undefined
        ? `${count} match, across the regions you buy from`
        : q.total
          ? `${count}, prices in every region you buy from`
          : 'Every Switch game, priced in every region';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {typing ? <View style={{ height: insets.top + space.md }} /> : <ScreenHeader title="Directory" subtitle={subtitle} />}
      <View style={[styles.search, { backgroundColor: c.raised }]}>
        <Ionicons name="search" size={17} color={c.subtle} />
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={isSteam ? 'Search Steam' : 'Search games'}
          placeholderTextColor={c.subtle}
          style={[styles.input, { color: c.text }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search games"
        />
        {text ? (
          <Pressable onPress={() => setText('')} hitSlop={14} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={c.subtle} />
          </Pressable>
        ) : null}
      </View>
      <PlatformTabs value={platform} options={TABS} onChange={setPlatform} />
      {/* Steam search has no sort or filters: Steam charges your own account's country */}
      {!isSteam ? (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
            {showUpgrades ? null : (
              <>
                <SortChip value={sort} options={SORTS} onChange={setSort} title="Sort games" />
                <CountryChip value={country?.code} onChange={setCountry} />
                <ChipDivider />
              </>
            )}
            <Chip label="Upgrade packs" active={showUpgrades} onPress={() => setUpgrades((v) => !v)} accessibilityLabel="Show games with a Switch 2 Edition upgrade pack" />
            {showUpgrades ? null : (
              <>
                <Chip label="On sale" active={onSale} onPress={() => setOnSale((v) => !v)} />
                <Chip label="50% off or more" active={big} onPress={() => setBig((v) => !v)} />
                <Chip label={`Under ${formatMoney(limit, prefs.currency)}`} active={cheap} onPress={() => setCheap((v) => !v)} />
                {canAbroad ? <Chip label="Cheaper abroad" active={abroad} onPress={() => setAbroad((v) => !v)} /> : null}
              </>
            )}
          </ScrollView>
        </View>
      ) : null}
      {showUpgrades ? (
        <UpgradeList search={text} />
      ) : (
      <FlashList
        // An emptied Steam search shows its prompt, not the last results kept on screen while typing
        data={isSteam && query.trim().length < 2 ? [] : q.items}
        keyExtractor={(it) => it.game.key}
        renderItem={renderItem}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isSteam && query.trim().length < 2 ? (
            <EmptyState title="Search Steam" body="Type a game’s name. Open it to compare prices across Steam regions." />
          ) : q.isPending ? (
            <RowSkeleton />
          ) : q.isError ? (
            <EmptyState title="Couldn’t load games" body={errorText(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
          ) : !isSteam && filtered ? (
            <EmptyState
              title="Nothing matches"
              body={
                query.trim()
                  ? `No games called "${query.trim()}" fit those filters. Try removing one.`
                  : country && !onSale && !big && !cheap
                    ? `We don’t have prices from the ${country.name} eShop for these games yet.`
                    : 'No games fit those filters. Try removing one.'
              }
              action={{ label: 'Clear filters', onPress: clear }}
            />
          ) : (
            <EmptyState
              title="No games found"
              body={query.trim() ? `Nothing matches "${query.trim()}". Check the spelling or try fewer words.` : 'There are no games to show here right now. Pull down to try again.'}
            />
          )
        }
        onEndReachedThreshold={0.7}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.xxl }} color={c.subtle} /> : <View style={{ height: space.xxl }} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={c.subtle} />}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: GUTTER, marginBottom: space.sm, paddingHorizontal: space.md, height: 44, borderRadius: radius.md },
  input: { flex: 1, height: '100%', fontFamily: font.regular, fontSize: 16 },
  filters: { gap: space.sm, paddingHorizontal: GUTTER, paddingTop: space.xs, paddingBottom: space.sm, alignItems: 'center' },
});
