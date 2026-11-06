import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { ApiListItem } from '@shared/api';
import { errorText } from '../../api/client';
import { CountryChip, useCountry } from '../../components/CountryFilter';
import { GameRow } from '../../components/GameRow';
import { ScreenHeader } from '../../components/ScreenHeader';
import { EmptyState, PlatformTabs, RowSkeleton } from '../../components/ui';
import { useDirectory, type DirectoryPlatform } from '../../hooks/queries';
import { font, GUTTER, platformMeta, radius, space, useTheme } from '../../theme';

const TABS: { value: DirectoryPlatform; label: string; dot?: string }[] = [
  { value: 'all-switch', label: 'All Switch' },
  { value: 'switch2', label: 'Switch 2', dot: platformMeta.switch2.dot },
  { value: 'switch', label: 'Switch', dot: platformMeta.switch.dot },
  { value: 'steam', label: 'Steam', dot: platformMeta.steam.dot },
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DirectoryScreen() {
  const { c } = useTheme();
  const [platform, setPlatform] = useState<DirectoryPlatform>('all-switch');
  const [text, setText] = useState('');
  const query = useDebounced(text);
  const isSteam = platform === 'steam';
  const [countryCode, setCountry] = useState<string>();
  const country = useCountry(isSteam ? undefined : countryCode);
  const q = useDirectory(platform, query, country?.code);

  const renderItem = useCallback(
    ({ item }: { item: ApiListItem }) => <GameRow game={item.game} prices={item.prices} ticker={!isSteam} showPlatform={platform === 'all-switch'} />,
    [isSteam, platform],
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Directory" subtitle={
          isSteam
            ? 'Search the Steam store'
            : country
              ? `${q.total !== undefined ? `${q.total.toLocaleString()} games` : 'Games'} sold in the ${country.flag} ${country.name} eShop`
              : q.total
                ? `${q.total.toLocaleString()} games, prices in every region you buy from`
                : 'Every Switch game, priced in every region'
        } />
      <View style={[styles.search, { backgroundColor: c.raised }]}>
        <Ionicons name="search" size={17} color={c.subtle} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={isSteam ? 'Search Steam' : 'Search games'}
          placeholderTextColor={c.subtle}
          style={[styles.input, { color: c.text }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search games"
        />
        {text ? (
          <Pressable onPress={() => setText('')} hitSlop={12} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={c.subtle} />
          </Pressable>
        ) : null}
      </View>
      <PlatformTabs value={platform} options={TABS} onChange={setPlatform} />
      {!isSteam ? (
        <View style={styles.filters}>
          <CountryChip value={country?.code} onChange={setCountry} />
        </View>
      ) : null}
      <FlashList
        data={q.items}
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
          ) : (
            <EmptyState
              title="No games found"
              body={
                country && !query.trim()
                  ? `We don’t have prices from the ${country.name} eShop for these games yet.`
                  : `Nothing matches "${query.trim()}"${country ? ` in the ${country.name} eShop` : ''}. Check the spelling or try fewer words.`
              }
              action={country ? { label: 'Show all regions', onPress: () => setCountry(undefined) } : undefined}
            />
          )
        }
        onEndReachedThreshold={0.7}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.xxl }} color={c.subtle} /> : <View style={{ height: space.xxl }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: GUTTER, marginBottom: space.sm, paddingHorizontal: space.md, height: 44, borderRadius: radius.md },
  input: { flex: 1, height: '100%', fontFamily: font.regular, fontSize: 16 },
  filters: { flexDirection: 'row', paddingHorizontal: GUTTER, paddingTop: space.xs, paddingBottom: space.sm },
});
