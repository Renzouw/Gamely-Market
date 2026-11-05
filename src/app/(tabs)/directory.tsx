import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '../../api/http';
import { GameRow } from '../../components/GameRow';
import { Chip, ChipRow, EmptyState, ListSkeleton } from '../../components/ui';
import { useDirectory, type DirectoryPlatform, type ListedGame } from '../../hooks/queries';
import { platformMeta, radius, space, useTheme } from '../../theme';

const FILTERS: { value: DirectoryPlatform; label: string; color?: string }[] = [
  { value: 'all-switch', label: 'All Switch' },
  { value: 'switch2', label: 'Switch 2', color: platformMeta.switch2.color },
  { value: 'switch', label: 'Switch', color: platformMeta.switch.color },
  { value: 'steam', label: 'Steam', color: platformMeta.steam.color },
];

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DirectoryScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [platform, setPlatform] = useState<DirectoryPlatform>('all-switch');
  const [text, setText] = useState('');
  const query = useDebounced(text);
  const q = useDirectory(platform, query);
  const isSteam = platform === 'steam';

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: ListedGame[] = [];
    for (const page of q.data?.pages ?? []) for (const it of page.items) if (!seen.has(it.game.key)) (seen.add(it.game.key), out.push(it));
    return out;
  }, [q.data]);

  const total = q.data?.pages[0]?.total;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + space.md }}>
        <Text style={[styles.h1, { color: c.text }]}>Directory</Text>
        <Text style={[styles.subtitle, { color: c.textDim }]}>
          {isSteam ? 'Search the Steam store' : `Every Switch game with live prices per region${total ? ` · ${total.toLocaleString()} games` : ''}`}
        </Text>
        <View style={[styles.search, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.textFaint} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={isSteam ? 'Search Steam games' : 'Search Switch games'}
            placeholderTextColor={c.textFaint}
            style={[styles.input, { color: c.text }]}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={c.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} active={platform === f.value} color={f.color} onPress={() => setPlatform(f.value)} />
          ))}
        </ChipRow>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.game.key}
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => <GameRow game={item.game} prices={item.prices} showRegions={!isSteam} showPlatform={platform === 'all-switch'} />}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
        ListEmptyComponent={
          isSteam && query.trim().length < 2 ? (
            <EmptyState icon="logo-steam" title="Search Steam" body="Type a game name. Open a game to compare its price across Steam regions." />
          ) : q.isPending ? (
            <ListSkeleton />
          ) : q.isError ? (
            <EmptyState icon="cloud-offline-outline" title="Couldn't load games" body={friendlyError(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
          ) : (
            <EmptyState icon="search-outline" title="No games found" body="Check the spelling or try a shorter name." />
          )
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.xl }} color={c.textDim} /> : <View style={{ height: space.xl }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: space.lg },
  subtitle: { fontSize: 13.5, marginTop: 2, paddingHorizontal: space.lg },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 44,
  },
  input: { flex: 1, fontSize: 16, height: '100%' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 128 + space.md },
});
