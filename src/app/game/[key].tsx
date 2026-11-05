import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RegionTable } from '../../components/RegionTable';
import { Sparkline } from '../../components/Sparkline';
import { Button, DiscountBadge, EmptyState, Pill, PlatformTag, SectionTitle, Skeleton, tap } from '../../components/ui';
import { americasCatalogEnabled } from '../../api/nintendo';
import { formatMoney, timeLeft } from '../../domain/pricing';
import { regionLabel } from '../../domain/regions';
import { useFx, useGame, useRegionalPrices, useSteamDetails } from '../../hooks/queries';
import { usePriceSummary } from '../../hooks/usePriceSummary';
import { useWatchlist } from '../../state/watchlist';
import { radius, space, useTheme } from '../../theme';

export default function GameScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { c } = useTheme();
  const watched = useWatchlist((s) => s.items[key]);
  const game = useGame(key, watched?.game);

  if (!game.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {game.isError ? (
          <EmptyState icon="alert-circle-outline" title="Couldn't find this game" action={{ label: 'Try again', onPress: () => game.refetch() }} />
        ) : (
          <ActivityIndicator style={{ marginTop: 160 }} color={c.textDim} />
        )}
      </View>
    );
  }
  return <GameDetail gameKey={key} />;
}

function GameDetail({ gameKey }: { gameKey: string }) {
  const { c } = useTheme();
  const watchItem = useWatchlist((s) => s.items[gameKey]);
  const { add, remove, setTarget, record } = useWatchlist.getState();
  const { data: base } = useGame(gameKey, watchItem?.game);
  const regional = useRegionalPrices(base);
  const game = regional.data?.game ?? base!;
  const prices = regional.data?.prices ?? [];
  const s = usePriceSummary(game, prices);
  const fx = useFx().data;
  const steam = useSteamDetails(game.steamAppId);
  const [targetText, setTargetText] = useState(watchItem?.target?.toString() ?? '');

  // Each time we have a fresh best price for a watched game, add it to its history.
  // Same-window readings replace each other, so re-running this is harmless.
  const best = s.best;
  const watching = !!watchItem;
  const bestConverted = best?.converted;
  const bestCountry = best?.country;
  useEffect(() => {
    if (watching && bestConverted !== undefined && bestCountry && regional.isSuccess) record(gameKey, bestConverted, bestCountry);
  }, [watching, bestConverted, bestCountry, regional.isSuccess, regional.dataUpdatedAt, gameKey, record]);

  const bestRegion = best ? regionLabel(best.country) : undefined;
  const homeIsBest = best && s.home && best.country === s.home.country;
  const left = timeLeft(best?.saleEndsAt);
  const isSteam = game.platform === 'steam';
  const missingGroups =
    !isSteam && regional.isSuccess
      ? [!game.nsuids?.americas && (americasCatalogEnabled ? 'Americas' : null), !game.nsuids?.europe && 'Europe', !game.nsuids?.japan && 'Japan'].filter(Boolean)
      : [];

  const toggleWatch = () => {
    tap();
    if (watchItem) remove(gameKey);
    else add(game);
  };

  const applyTarget = (value?: number) => {
    const v = value !== undefined ? Math.round(value * 100) / 100 : undefined;
    setTarget(gameKey, v);
    setTargetText(v !== undefined ? String(v) : '');
  };

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={regional.isRefetching} onRefresh={() => void regional.refetch()} tintColor={c.textDim} />}
      >
        <View>
          <Image source={steam.data?.image ?? game.image} style={[styles.hero, { backgroundColor: c.surface2 }]} contentFit="cover" transition={200} />
          <View style={styles.heroShade} />
        </View>

        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <PlatformTag platform={game.platform} />
            {steam.data?.metacritic ? <Pill text={`Metacritic ${steam.data.metacritic}`} /> : null}
          </View>
          <Text style={[styles.title, { color: c.text }]}>{game.title}</Text>
          <Text style={[styles.meta, { color: c.textDim }]}>
            {[game.publisher ?? steam.data?.publisher, formatRelease(game.releaseDate ?? steam.data?.releaseDate)].filter(Boolean).join(' · ')}
          </Text>

          {/* Best price */}
          <View style={[styles.bestCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            {regional.isPending ? (
              <View style={{ gap: 10 }}>
                <Skeleton height={14} width="30%" />
                <Skeleton height={34} width="55%" />
                <Skeleton height={14} width="70%" />
              </View>
            ) : best && best.converted !== undefined ? (
              <>
                <Text style={[styles.label, { color: c.textDim }]}>{isSteam ? 'CHEAPEST STEAM REGION' : 'BEST PRICE RIGHT NOW'}</Text>
                <View style={styles.bestLine}>
                  <Text style={[styles.bestPrice, { color: c.text }]}>{formatMoney(best.converted, s.homeCurrency)}</Text>
                  <DiscountBadge percent={best.discountPercent} large />
                </View>
                <Text style={[styles.bestWhere, { color: c.textDim }]}>
                  {bestRegion?.flag} {bestRegion?.name}
                  {best.current.currency !== s.homeCurrency ? ` · ${formatMoney(best.current.amount, best.current.currency)}` : ''}
                </Text>
                {!homeIsBest && s.home?.converted !== undefined && s.savingVsHome !== undefined && s.savingVsHome >= 0.01 ? (
                  <View style={[styles.saving, { backgroundColor: c.goodBg }]}>
                    <Ionicons name="trending-down" size={16} color={c.good} />
                    <Text style={{ color: c.good, fontWeight: '700', flex: 1 }}>
                      {Math.round(s.savingVsHome * 100)}% less than your {isSteam ? 'store' : 'eShop'} ({formatMoney(s.home.converted, s.homeCurrency)})
                    </Text>
                  </View>
                ) : homeIsBest ? (
                  <View style={[styles.saving, { backgroundColor: c.goodBg }]}>
                    <Ionicons name="checkmark-circle" size={16} color={c.good} />
                    <Text style={{ color: c.good, fontWeight: '700' }}>Your own {isSteam ? 'store' : 'eShop'} is the cheapest</Text>
                  </View>
                ) : null}
                {left ? (
                  <Text style={[styles.ends, { color: c.warn }]}>
                    <Ionicons name="time-outline" size={13} color={c.warn} /> Sale ends in {left}
                  </Text>
                ) : null}
              </>
            ) : regional.isError ? (
              <Text style={{ color: c.textDim }}>Couldn't load prices. Pull down to retry.</Text>
            ) : prices.length && !fx ? (
              <Text style={{ color: c.textDim }}>Waiting for exchange rates…</Text>
            ) : (
              <Text style={{ color: c.textDim }}>Not sold in any of your selected regions right now.</Text>
            )}

            <View style={styles.actions}>
              <Button
                label={watchItem ? 'Watching' : 'Watch price'}
                icon={watchItem ? 'heart' : 'heart-outline'}
                onPress={toggleWatch}
                variant={watchItem ? 'secondary' : 'primary'}
                style={{ flex: 1 }}
              />
              {game.storeUrl ? (
                <Button label="Store" icon="open-outline" variant="secondary" onPress={() => Linking.openURL(game.storeUrl!)} />
              ) : null}
            </View>
          </View>

          {/* Target price */}
          {watchItem ? (
            <View style={[styles.block, { backgroundColor: c.surface, borderColor: c.border }]}>
              <SectionTitle>Alert me at</SectionTitle>
              <View style={styles.targetRow}>
                <View style={[styles.targetInput, { backgroundColor: c.surface2, borderColor: c.border }]}>
                  <Text style={{ color: c.textDim, fontWeight: '700' }}>{s.homeCurrency}</Text>
                  <TextInput
                    value={targetText}
                    onChangeText={setTargetText}
                    onEndEditing={() => {
                      const v = parseFloat(targetText.replace(',', '.'));
                      applyTarget(Number.isFinite(v) && v >= 0 ? v : undefined);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="Any price"
                    placeholderTextColor={c.textFaint}
                    style={[styles.targetText, { color: c.text }]}
                  />
                </View>
                {watchItem.target !== undefined ? (
                  <Pressable onPress={() => applyTarget(undefined)} hitSlop={8}>
                    <Text style={{ color: c.textDim }}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              {best?.converted ? (
                <View style={styles.quick}>
                  {[0.9, 0.75, 0.5].map((f) => (
                    <Pressable key={f} onPress={() => applyTarget(best.converted! * f)} style={[styles.quickChip, { borderColor: c.border }]}>
                      <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>
                        −{Math.round((1 - f) * 100)}% · {formatMoney(best.converted! * f, s.homeCurrency)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Text style={[styles.hint, { color: c.textFaint }]}>
                You'll get a notification when the best price in your regions drops to this. Turn alerts on in Settings.
              </Text>
            </View>
          ) : null}

          {/* History */}
          {watchItem && watchItem.history.length >= 2 ? (
            <View style={[styles.block, { backgroundColor: c.surface, borderColor: c.border }]}>
              <SectionTitle
                right={
                  watchItem.lowest !== undefined ? (
                    <Text style={{ color: c.good, fontWeight: '700', fontSize: 12 }}>Lowest seen {formatMoney(watchItem.lowest, s.homeCurrency)}</Text>
                  ) : null
                }
              >
                Price since you started watching
              </SectionTitle>
              <Sparkline points={watchItem.history} color={c.accent} />
            </View>
          ) : null}

          {/* Regions */}
          <View style={{ marginTop: space.xl }}>
            <SectionTitle right={regional.isFetching ? <ActivityIndicator size="small" color={c.textDim} /> : null}>
              {isSteam ? 'Steam price by region' : 'Price by region'}
            </SectionTitle>
            {isSteam ? (
              <Text style={[styles.hint, { color: c.textDim, marginBottom: space.sm }]}>
                Steam sells at the price of your account's country, so this is for comparison. Changing store region breaks Steam's rules.
              </Text>
            ) : null}
            {s.ranked.length ? (
              <RegionTable ranked={s.ranked} homeCountry={s.home?.country} homeCurrency={s.homeCurrency} />
            ) : regional.isPending ? (
              <View style={{ gap: 8 }}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={54} />
                ))}
              </View>
            ) : (
              <Text style={{ color: c.textDim }}>No regional prices found.</Text>
            )}
            {missingGroups.length ? (
              <Text style={[styles.hint, { color: c.textFaint }]}>Couldn't match this game in: {missingGroups.join(', ')}.</Text>
            ) : null}
          </View>

          {steam.data?.description ? (
            <View style={{ marginTop: space.xl }}>
              <SectionTitle>About</SectionTitle>
              <Text style={{ color: c.textDim, lineHeight: 21 }}>{steam.data.description}</Text>
            </View>
          ) : null}

          <Text style={[styles.footer, { color: c.textFaint }]}>
            Prices from {isSteam ? 'the Steam store' : 'Nintendo eShop'}, converted to {s.homeCurrency} with daily exchange rates
            {fx ? ` (${new Date(fx.updatedAt).toLocaleDateString()})` : ''}. Your bank's rate and fees will differ a little.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

function formatRelease(date?: string): string | undefined {
  if (!date) return undefined;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  hero: { width: '100%', aspectRatio: 16 / 9 },
  heroShade: { position: 'absolute', left: 0, right: 0, top: 0, height: 100, backgroundColor: 'rgba(0,0,0,0.35)' },
  pad: { paddingHorizontal: space.lg, paddingTop: space.lg },
  title: { fontSize: 26, fontWeight: '800', marginTop: space.sm, letterSpacing: -0.3 },
  meta: { fontSize: 13.5, marginTop: 4 },
  bestCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, gap: 6 },
  label: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  bestLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bestPrice: { fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  bestWhere: { fontSize: 15 },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: space.sm, borderRadius: radius.md, marginTop: 4 },
  ends: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  block: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  targetInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, height: 44 },
  targetText: { flex: 1, fontSize: 17, fontWeight: '700', height: '100%' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
  quickChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: space.sm },
  footer: { fontSize: 11.5, lineHeight: 16, marginTop: space.xl },
});
