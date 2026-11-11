import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import type { AlertPrefs, ApiGame } from '@shared/api';
import { currencyDigits, formatMoney, timeLeft } from '@shared/pricing';
import { KIND_LABEL, listingKind } from '@shared/listing';
import { eshopTitleUrl, regionLabel, switchRegion } from '@shared/regions';
import type { ConvertedRegionPrice } from '@shared/types';
import { errorText } from '../../api/client';
import { PriceChart } from '../../components/PriceChart';
import { PriceSpread } from '../../components/PriceSpread';
import { showToast } from '../../components/Toast';
import { Button, Cover, EmptyState, Group, haptic, PlatformLabel, Row, Sheet, Skeleton, SwitchRow } from '../../components/ui';
import { useDataMode, useFx, useGameDetail, useIsWatched, usePriceSummary, useWatchActions } from '../../hooks/queries';
import { ago, parseTarget, shortDate } from '../../lib/format';
import { turnOnAlerts } from '../../services/turnOnAlerts';
import { useSettings } from '../../state/settings';
import { useWatchlist } from '../../state/watchlist';
import { font, GUTTER, radius, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const GROUP_NAMES = { americas: 'the Americas', europe: 'Europe', japan: 'Japan', hongkong: 'Hong Kong', korea: 'South Korea', sea: 'Southeast Asia' } as const;

/** "Japan", "Japan or Hong Kong", "Japan, Hong Kong or South Korea" */
function listNames(groups: (keyof typeof GROUP_NAMES)[], joiner: 'and' | 'or'): string {
  const names = groups.map((g) => GROUP_NAMES[g]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}` : (names[0] ?? '');
}

/** Regions shown before "Show all": the cheapest few, plus your own eShop wherever it ranks */
const FIRST_REGIONS = 6;

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/** The game's ID in each region group, including the one its key carries (sw:eu:… or sw:us:…) */
function regionIds(g: ApiGame): ApiGame['nsuids'] {
  const [, src, id] = g.key.split(':');
  const own = src === 'eu' ? { europe: id } : src === 'us' ? { americas: id } : {};
  return { ...own, ...g.nsuids };
}

/** Android doesn't move the page for the keyboard by itself, so the page makes room for it */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (RNPlatform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => (show.remove(), hide.remove());
  }, []);
  return h;
}

export default function GameScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { c, dark } = useTheme();
  const { width } = useWindowDimensions();
  const q = useGameDetail(key);
  const d = q.data;
  const s = usePriceSummary(d?.game.platform ?? 'switch', d?.prices ?? []);
  const fx = useFx().data;
  const mode = useDataMode();
  const watch = useIsWatched(key);
  const { save, remove, restore } = useWatchActions();
  const alertsPrompted = useSettings((x) => x.alertsPrompted);
  const [primer, setPrimer] = useState(false);
  const [allRegions, setAllRegions] = useState(false);
  // Light status bar icons while the cover is behind them
  const [overCover, setOverCover] = useState(true);
  const scroll = useRef<ScrollViewInstance>(null);
  const alertsBox = useRef({ y: 0, height: 0 });
  const keyboard = useKeyboardHeight();
  const { height: screenH } = useWindowDimensions();
  const targetFocused = useRef(false);
  // Keep the target price box above the keyboard while typing
  useEffect(() => {
    if (!keyboard || !targetFocused.current) return;
    const bottom = alertsBox.current.y + alertsBox.current.height;
    scroll.current?.scrollTo({ y: Math.max(0, bottom - (screenH - keyboard) + space.xxl), animated: true });
  }, [keyboard, screenH]);

  if (!d) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {q.isError ? (
          <View style={{ paddingTop: 120 }}>
            <EmptyState title="Couldn’t open this game" body={errorText(q.error)} action={{ label: 'Try again', onPress: () => q.refetch() }} />
          </View>
        ) : (
          <View>
            <Skeleton height={(width * 9) / 16} rounded={0} />
            <View style={{ padding: GUTTER, gap: space.md }}>
              <Skeleton height={26} width="70%" />
              <Skeleton height={14} width="40%" />
              <Skeleton height={120} rounded={radius.lg} style={{ marginTop: space.lg }} />
            </View>
          </View>
        )}
      </View>
    );
  }

  const g = d.game;
  const isSteam = g.platform === 'steam';
  const kind = listingKind(g);
  const best = s.best;
  const placeholder = 'placeholder' in d;
  const homeIsBest = best && s.home && best.country === s.home.country;
  // On Steam you can only buy at your own store's price, so that is the headline
  const headline = isSteam ? (s.home ?? best) : best;
  const left = timeLeft(headline?.saleEndsAt);
  const atLowest = headline?.converted !== undefined && d.lowest && headline.converted <= d.lowest.price + 0.01;
  const checked = d.prices.length ? Math.min(...d.prices.map((p) => p.checkedAt)) : undefined;
  // Each region's own eShop page; Store opens the one the headline price is from
  const ids = isSteam ? undefined : regionIds(g as ApiGame);
  const urlFor = (country: string) => (ids ? eshopTitleUrl(country, ids) : undefined);
  const headlineUrl = headline ? urlFor(headline.country) : undefined;
  const storeUrl = headlineUrl ?? g.storeUrl;

  const toggleWatch = () => {
    if (watch) {
      haptic('light');
      // Keep everything it had (target price, alert switches) for Undo
      const was = useWatchlist.getState().items[g.key];
      remove.mutate(g.key);
      if (was) showToast(`Stopped watching ${g.title}`, { label: 'Undo', onPress: () => restore.mutate(was) });
      return;
    }
    haptic('success');
    save.mutate({ game: g as ApiGame, input: {} });
    if (!alertsPrompted && RNPlatform.OS !== 'web') setPrimer(true);
  };

  const closePrimer = () => {
    setPrimer(false);
    useSettings.getState().set({ alertsPrompted: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={overCover || dark ? 'light' : 'dark'} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingBottom: 56 + keyboard }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        scrollEventThrottle={64}
        onScroll={(e) => {
          const over = e.nativeEvent.contentOffset.y < (width * 9) / 16 - 80;
          if (over !== overCover) setOverCover(over);
        }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.subtle} />}
      >
        <View>
          <Cover uri={g.image} title={g.title} platform={g.platform} width={width} height={(width * 9) / 16} rounded={0} />
          <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} style={styles.topShade} pointerEvents="none" />
          <LinearGradient colors={[c.scrim, c.scrimEnd]} style={styles.bottomShade} pointerEvents="none" />
        </View>

        <View style={styles.pad}>
          <PlatformLabel platform={g.platform} />
          <Text variant="largeTitle" style={{ marginTop: space.xs }} accessibilityRole="header">
            {g.title}
          </Text>
          <Text variant="footnote" tone="subtle" style={{ marginTop: space.xs }}>
            {[g.publisher, shortDate(g.releaseDate)].filter(Boolean).join(' · ')}
          </Text>
          {kind !== 'game' ? (
            <View style={{ marginTop: space.md }}>
              <Fact tone="muted" icon={kind === 'upgrade' ? 'arrow-up-circle-outline' : 'people-outline'}>
                {KIND_LABEL[kind].explain}
              </Fact>
            </View>
          ) : null}

          <View style={styles.priceBlock}>
            {placeholder && !headline ? (
              <Skeleton height={44} width="55%" />
            ) : headline?.converted !== undefined ? (
              <>
                <Text variant="overline" tone="subtle">
                  {isSteam ? 'Your Steam price' : homeIsBest ? 'Best price, in your eShop' : 'Best price right now'}
                </Text>
                <View style={styles.priceLine}>
                  <Text variant="priceXL" accessibilityLabel={`${formatMoney(headline.converted, s.currency)}${headline.discountPercent ? `, ${headline.discountPercent}% off` : ''}`}>
                    {formatMoney(headline.converted, s.currency)}
                  </Text>
                  {headline.discountPercent ? (
                    <View style={[styles.off, { backgroundColor: c.signal }]}>
                      <Text variant="priceS" style={{ color: c.signalInk }}>
                        −{headline.discountPercent}%
                      </Text>
                    </View>
                  ) : null}
                </View>
                {!isSteam ? (
                  <Text variant="callout" tone="muted">
                    {regionLabel(headline.country).flag} {regionLabel(headline.country).name}
                    {headline.current.currency !== s.currency ? `  ·  ${formatMoney(headline.current.amount, headline.current.currency)}` : ''}
                  </Text>
                ) : headline.sale ? (
                  <Text variant="callout" tone="muted">
                    Usually {formatMoney(headline.convertedRegular, s.currency)}
                  </Text>
                ) : null}
                <View style={{ gap: space.xs, marginTop: space.sm }}>
                  {!isSteam && !homeIsBest && s.savingVsHome && s.savingVsHome >= 0.01 && s.home?.converted !== undefined ? (
                    <Fact tone="signal" icon="trending-down">
                      {Math.round(s.savingVsHome * 100)}% less than your eShop ({formatMoney(s.home.converted, s.currency)})
                    </Fact>
                  ) : null}
                  {left ? (
                    <Fact tone="warn" icon="time-outline">
                      Sale ends in {left}
                    </Fact>
                  ) : null}
                  {d.stale ? (
                    <Fact tone="warn" icon="alert-circle-outline">
                      Not confirmed in over a day. Check the store before buying.
                    </Fact>
                  ) : null}
                  {atLowest && headline.sale ? (
                    <Fact tone="signal" icon="ribbon-outline">
                      Lowest price we’ve recorded
                    </Fact>
                  ) : d.lowest ? (
                    <Fact tone="muted" icon="stats-chart-outline">
                      Lowest recorded: {formatMoney(d.lowest.price, s.currency)} in {regionLabel(d.lowest.country).name}, {shortDate(d.lowest.at)}
                    </Fact>
                  ) : null}
                </View>
              </>
            ) : (
              <Text variant="body" tone="muted">
                {d.prices.length && !fx ? 'Loading exchange rates…' : 'Not sold in any of your regions right now.'}
              </Text>
            )}

            <View style={styles.actions}>
              <Button
                label={watch ? 'Watching' : 'Watch price'}
                icon={watch ? 'checkmark' : 'notifications-outline'}
                variant={watch ? 'secondary' : 'primary'}
                onPress={toggleWatch}
                style={{ flex: 1 }}
                accessibilityLabel={watch ? 'Stop watching' : 'Watch price'}
              />
              {storeUrl ? (
                <Button
                  label={headlineUrl && headline ? `${regionLabel(headline.country).flag} Store` : 'Store'}
                  icon="open-outline"
                  variant="secondary"
                  onPress={() => open(storeUrl)}
                  accessibilityLabel={isSteam ? 'Open in Steam' : headlineUrl && headline ? `Open the ${regionLabel(headline.country).name} eShop` : 'Open in the Nintendo eShop'}
                />
              ) : null}
            </View>
          </View>
        </View>

        {watch ? (
          <View onLayout={(e) => (alertsBox.current = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })}>
            <AlertSettings
              game={g as ApiGame}
              target={watch.target}
              alerts={watch.alerts}
              currency={s.currency}
              suggested={headline?.converted}
              onTargetFocus={(focused) => (targetFocused.current = focused)}
            />
          </View>
        ) : null}

        {s.ranked.length ? (
          <View style={[styles.pad, { marginTop: space.xxxl }]}>
            <Text variant="title">{isSteam ? 'Steam prices by region' : 'Every region'}</Text>
            <Text variant="footnote" tone="subtle" style={{ marginTop: 2, marginBottom: space.lg }}>
              {isSteam ? "Steam charges your account’s country price, so this is for comparison only." : `Converted to ${s.currency}, cheapest first. Tap a region to open its eShop.`}
            </Text>
            <PriceSpread ranked={s.ranked} homeCountry={s.home?.country} currency={s.currency} />
            <View style={{ marginTop: space.lg }}>
              {s.ranked.map((p, i) =>
                // Folded: the cheapest few and your own eShop
                allRegions || s.ranked.length <= FIRST_REGIONS + 2 || i < FIRST_REGIONS || p.country === s.home?.country ? (
                  <RegionRow key={p.country} p={p} best={i === 0} home={p.country === s.home?.country} currency={s.currency} first={i === 0} steam={isSteam} url={urlFor(p.country)} />
                ) : null,
              )}
            </View>
            {!allRegions && s.ranked.length > FIRST_REGIONS + 2 ? (
              <Pressable
                onPress={() => (haptic(), setAllRegions(true))}
                accessibilityRole="button"
                accessibilityState={{ expanded: false }}
                style={({ pressed }) => [styles.more, { borderTopColor: c.line, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text variant="headline">Show all {s.ranked.length} regions</Text>
                <Ionicons name="chevron-down" size={16} color={c.muted} />
              </Pressable>
            ) : null}
            {d.unmatched.length ? (
              <Text variant="footnote" tone="subtle" style={{ marginTop: space.md }}>
                {mode === 'direct'
                  ? `Prices for ${listNames(d.unmatched, 'and')} need your Gamely server to find this game there, and it isn’t reachable right now.`
                  : `We couldn’t confirm this exact game in ${listNames(d.unmatched, 'or')}, so we left those prices out rather than risk showing the wrong game.`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!placeholder ? (
          <View style={[styles.pad, { marginTop: space.xxxl }]}>
            <Text variant="title">Price history</Text>
            <Text variant="footnote" tone="subtle" style={{ marginTop: 2, marginBottom: space.lg }}>
              Best price each day across your regions{d.trackedSince ? `, since ${shortDate(d.trackedSince)}` : ''}.
            </Text>
            <PriceChart points={d.history} currency={s.currency} />
          </View>
        ) : null}

        <Text variant="footnote" tone="subtle" style={[styles.pad, { marginTop: space.xxxl }]}>
          {checked ? `Prices confirmed with ${isSteam ? 'Steam' : 'the Nintendo eShop'} ${ago(checked)}. ` : ''}
          {fx ? `Converted at European Central Bank rates from ${shortDate(fx.asOf)}${headline && fx.sources[headline.current.currency] === 'market' ? ` (${headline.current.currency} uses a market rate)` : ''}. ` : ''}
          Your bank’s rate and fees may differ slightly.
        </Text>
        {q.isFetching && placeholder ? <ActivityIndicator style={{ marginTop: space.xl }} color={c.subtle} /> : null}
      </ScrollView>

      <Sheet visible={primer} onClose={closePrimer} title="Get a heads-up?">
        <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
          <Text variant="body" tone="muted">
            We’ll tell you when {g.title} goes on sale, hits its lowest price, or a sale is about to end. One alert per change, and nothing overnight.
          </Text>
          <Button label="Turn on alerts" onPress={() => (setPrimer(false), void turnOnAlerts())} />
          <Button label="Not now" variant="quiet" onPress={closePrimer} />
        </View>
      </Sheet>
    </View>
  );
}

function Fact({ tone, icon, children }: { tone: 'signal' | 'warn' | 'muted'; icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const { c } = useTheme();
  const color = tone === 'signal' ? c.signalText : tone === 'warn' ? c.warn : c.muted;
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={color} />
      <Text variant="callout" style={{ color, flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

function RegionRow({
  p,
  best,
  home,
  currency,
  first,
  steam,
  url,
}: {
  p: ConvertedRegionPrice;
  best: boolean;
  home: boolean;
  currency: string;
  first: boolean;
  steam?: boolean;
  /** That country's eShop page for this game, when there is one */
  url?: string;
}) {
  const { c } = useTheme();
  const r = regionLabel(p.country);
  const note = switchRegion(p.country)?.note;
  const detail = [home ? (steam ? 'Your store' : 'Your eShop') : undefined, p.current.currency !== currency ? formatMoney(p.current.amount, p.current.currency) : undefined, note].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessible
      onPress={url ? () => (haptic(), open(url)) : undefined}
      accessibilityRole={url ? 'link' : undefined}
      accessibilityHint={url ? `Opens the ${r.name} eShop` : undefined}
      accessibilityLabel={`${r.name}, ${formatMoney(p.converted, currency)}${p.discountPercent ? `, ${p.discountPercent}% off` : ''}${best ? ', cheapest' : ''}${home ? (steam ? ', your store' : ', your eShop') : ''}`}
      style={({ pressed }) => [styles.region, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && url ? { opacity: 0.6 } : null]}
    >
      {best ? <View style={[styles.bestRule, { backgroundColor: c.signalText }]} /> : null}
      <Text style={styles.flag}>{r.flag}</Text>
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {r.name}
        </Text>
        {detail ? (
          <Text variant="footnote" tone="subtle" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="priceM" tone={best ? 'signal' : 'text'}>
          {formatMoney(p.converted, currency)}
        </Text>
        {p.discountPercent ? (
          <Text variant="priceXS" tone="subtle">
            −{p.discountPercent}% · was {formatMoney(p.convertedRegular, currency)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function AlertSettings({
  game,
  target,
  alerts,
  currency,
  suggested,
  onTargetFocus,
}: {
  game: ApiGame;
  target?: number;
  alerts: AlertPrefs;
  currency: string;
  suggested?: number;
  onTargetFocus: (focused: boolean) => void;
}) {
  const { c } = useTheme();
  const { save } = useWatchActions();
  const alertsEnabled = useSettings((s) => s.alertsEnabled);
  const [text, setText] = useState(target !== undefined ? String(target) : '');
  // Follow the saved target when it changes elsewhere (e.g. "Remove target price")
  const [seenTarget, setSeenTarget] = useState(target);
  if (target !== seenTarget) {
    setSeenTarget(target);
    // Our own autosave doesn't rewrite what's being typed ("1499." stays, so "1499.50" can follow)
    if (parseTarget(text) !== target) setText(target !== undefined ? String(target) : '');
  }

  const set = (patch: Partial<AlertPrefs>) => save.mutate({ game, input: { alerts: patch } });
  const commitTarget = (v?: number) => save.mutate({ game, input: { target: v === undefined ? null : Math.round(v * 100) / 100 } });

  // The typed price is saved shortly after typing stops, and when leaving the page. Android's
  // back button closes the keyboard without "finishing" the edit, so neither can rely on that.
  const latest = useRef({ text, target });
  // A target saved (or removed) elsewhere resets what's typed, as the box itself does above
  useEffect(() => {
    const typed = latest.current.text;
    latest.current = { text: parseTarget(typed) === target ? typed : target !== undefined ? String(target) : '', target };
  }, [target]);
  const saveTyped = (feedback: boolean) => {
    const { text: t, target: saved } = latest.current;
    if (!useWatchlist.getState().items[game.key]) return; // stopped watching: don't bring it back
    // Mid-number ("1499." or "1,"): wait for the rest, unless leaving the page
    if (feedback && /[.,]$/.test(t.trim())) return;
    const next = parseTarget(t);
    if (next === saved || (next === undefined && t.trim() !== '')) return; // nothing new, or not a number yet
    commitTarget(next);
    if (feedback && next !== undefined) haptic('success');
  };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      saveTyped(false);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const footer = alertsEnabled ? undefined : RNPlatform.OS === 'web' ? 'Alerts arrive in the iOS and Android apps.' : 'Notifications are off on this phone, so these alerts can’t reach you yet.';

  return (
    <>
      <Group title="Alert me when" footer={footer}>
        <SwitchRow first label="It goes on sale" value={alerts.sale} onChange={(v) => set({ sale: v })} />
        <SwitchRow label="It hits its lowest price" value={alerts.low} onChange={(v) => set({ low: v })} />
        <SwitchRow label="A sale is about to end" detail="24 hours before" value={alerts.ending} onChange={(v) => set({ ending: v })} />
        <SwitchRow label="The price drops at all" detail="Every further drop, even small ones" value={alerts.drop} onChange={(v) => set({ drop: v })} />
        <Row
          label="It reaches my price"
          detail={target !== undefined ? `Alert at ${formatMoney(target, currency)} or less` : undefined}
          right={
            <View style={[styles.target, { backgroundColor: c.raised }]}>
              <TextInput
                value={text}
                onChangeText={(t) => {
                  setText(t);
                  latest.current.text = t;
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => saveTyped(true), 1200);
                }}
                onFocus={() => onTargetFocus(true)}
                onBlur={() => onTargetFocus(false)}
                onEndEditing={() => {
                  clearTimeout(timer.current);
                  saveTyped(true);
                }}
                maxFontSizeMultiplier={1.3}
                placeholder={suggested ? (suggested * 0.75).toFixed(currencyDigits(currency)) : 'Price'}
                placeholderTextColor={c.subtle}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel={`Target price in ${currency}`}
                style={[styles.targetInput, { color: c.text }]}
              />
              <Text variant="footnote" tone="subtle">
                {currency}
              </Text>
            </View>
          }
        />
      </Group>
      {!alertsEnabled && RNPlatform.OS !== 'web' ? (
        <Button label="Turn on alerts" icon="notifications-outline" variant="secondary" onPress={() => void turnOnAlerts()} style={styles.turnOn} />
      ) : null}
      {target !== undefined ? (
        <Pressable onPress={() => commitTarget(undefined)} style={styles.removeTarget} accessibilityRole="button">
          <Text variant="footnote" tone="muted">
            Remove target price
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 110 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90 },
  pad: { paddingHorizontal: GUTTER },
  priceBlock: { marginTop: space.xxl, gap: space.xs },
  priceLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  off: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  region: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  bestRule: { position: 'absolute', left: -GUTTER, top: space.md, bottom: space.md, width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  flag: { fontSize: 22, width: 28, textAlign: 'center' },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
  turnOn: { marginHorizontal: GUTTER, marginTop: space.md, height: 44 },
  removeTarget: { paddingHorizontal: GUTTER + space.xs, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  target: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 36, borderRadius: radius.sm, width: 132 },
  targetInput: { flex: 1, height: '100%', fontFamily: font.monoMedium, fontSize: 15, textAlign: 'right', minWidth: 60 },
});
