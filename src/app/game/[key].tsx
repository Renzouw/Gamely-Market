import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import type { AlertPrefs, ApiGame } from '@shared/api';
import { formatMoney, timeLeft } from '@shared/pricing';
import { regionLabel, switchRegion } from '@shared/regions';
import type { ConvertedRegionPrice } from '@shared/types';
import { errorText } from '../../api/client';
import { PriceChart } from '../../components/PriceChart';
import { PriceSpread } from '../../components/PriceSpread';
import { Button, Cover, EmptyState, Group, haptic, PlatformLabel, Row, Sheet, Skeleton, SwitchRow } from '../../components/ui';
import { useDataMode, useFx, useGameDetail, useIsWatched, usePrefs, usePriceSummary, useWatchActions } from '../../hooks/queries';
import { ago, shortDate } from '../../lib/format';
import { turnOnAlerts } from '../../services/turnOnAlerts';
import { useSettings } from '../../state/settings';
import { font, GUTTER, radius, space, useTheme } from '../../theme';
import { Text } from '../../theme/Text';

const GROUP_NAMES = { americas: 'the Americas', europe: 'Europe', japan: 'Japan' } as const;

export default function GameScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const q = useGameDetail(key);
  const d = q.data;
  const s = usePriceSummary(d?.game.platform ?? 'switch', d?.prices ?? []);
  const fx = useFx().data;
  const mode = useDataMode();
  const prefs = usePrefs();
  const watch = useIsWatched(key);
  const { save, remove } = useWatchActions();
  const alertsPrompted = useSettings((x) => x.alertsPrompted);
  const [primer, setPrimer] = useState(false);

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
  const best = s.best;
  const placeholder = 'placeholder' in d;
  const homeIsBest = best && s.home && best.country === s.home.country;
  // On Steam you can only buy at your own store's price, so that is the headline
  const headline = isSteam ? (s.home ?? best) : best;
  const left = timeLeft(headline?.saleEndsAt);
  const atLowest = headline?.converted !== undefined && d.lowest && headline.converted <= d.lowest.price + 0.01;
  const checked = d.prices.length ? Math.min(...d.prices.map((p) => p.checkedAt)) : undefined;

  const toggleWatch = () => {
    if (watch) {
      haptic('light');
      remove.mutate(g.key);
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
      <ScrollView
        contentContainerStyle={{ paddingBottom: 56 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.subtle} />}>
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
              {g.storeUrl ? (
                <Button label="Store" icon="open-outline" variant="secondary" onPress={() => Linking.openURL(g.storeUrl!)} accessibilityLabel={`Open in ${isSteam ? 'Steam' : 'the Nintendo eShop'}`} />
              ) : null}
            </View>
          </View>
        </View>

        {watch ? <AlertSettings game={g as ApiGame} target={watch.target} alerts={watch.alerts} currency={s.currency} suggested={headline?.converted} /> : null}

        {s.ranked.length ? (
          <View style={[styles.pad, { marginTop: space.xxxl }]}>
            <Text variant="title">{isSteam ? 'Steam prices by region' : 'Every region'}</Text>
            <Text variant="footnote" tone="subtle" style={{ marginTop: 2, marginBottom: space.lg }}>
              {isSteam ? "Steam charges your account’s country price, so this is for comparison only." : `Converted to ${s.currency}, cheapest first.`}
            </Text>
            <PriceSpread ranked={s.ranked} homeCountry={s.home?.country} currency={s.currency} />
            <View style={{ marginTop: space.lg }}>
              {s.ranked.map((p, i) => (
                <RegionRow key={p.country} p={p} best={i === 0} home={p.country === s.home?.country} currency={s.currency} first={i === 0} steam={isSteam} />
              ))}
            </View>
            {mode === 'direct' && !isSteam && prefs.switchRegions.some((r) => switchRegion(r)?.group === 'americas') ? (
              <Text variant="footnote" tone="subtle" style={{ marginTop: space.md }}>
                Prices for the Americas eShops come from your Gamely server, which isn’t reachable right now.
              </Text>
            ) : null}
            {d.unmatched.length ? (
              <Text variant="footnote" tone="subtle" style={{ marginTop: space.md }}>
                We couldn’t confirm this exact game in {d.unmatched.map((u) => GROUP_NAMES[u]).join(' or ')}, so we left those prices out rather than risk showing the wrong game.
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
        {d.stale ? (
          <Text variant="footnote" tone="warn" style={[styles.pad, { marginTop: space.sm }]}>
            Some of these prices haven’t been confirmed in over a day. Check the store before buying.
          </Text>
        ) : null}
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

function RegionRow({ p, best, home, currency, first, steam }: { p: ConvertedRegionPrice; best: boolean; home: boolean; currency: string; first: boolean; steam?: boolean }) {
  const { c } = useTheme();
  const r = regionLabel(p.country);
  const note = switchRegion(p.country)?.note;
  const detail = [home ? (steam ? 'Your store' : 'Your eShop') : undefined, p.current.currency !== currency ? formatMoney(p.current.amount, p.current.currency) : undefined, note].filter(Boolean).join(' · ');
  return (
    <View
      accessible
      accessibilityLabel={`${r.name}, ${formatMoney(p.converted, currency)}${p.discountPercent ? `, ${p.discountPercent}% off` : ''}${best ? ', cheapest' : ''}${home ? (steam ? ', your store' : ', your eShop') : ''}`}
      style={[styles.region, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}
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
    </View>
  );
}

function AlertSettings({ game, target, alerts, currency, suggested }: { game: ApiGame; target?: number; alerts: AlertPrefs; currency: string; suggested?: number }) {
  const { c } = useTheme();
  const { save } = useWatchActions();
  const alertsEnabled = useSettings((s) => s.alertsEnabled);
  const [text, setText] = useState(target !== undefined ? String(target) : '');
  // Follow the saved target when it changes elsewhere (e.g. "Remove target price")
  const [seenTarget, setSeenTarget] = useState(target);
  if (target !== seenTarget) {
    setSeenTarget(target);
    setText(target !== undefined ? String(target) : '');
  }

  const set = (patch: Partial<AlertPrefs>) => save.mutate({ game, input: { alerts: patch } });
  const commitTarget = (v?: number) => save.mutate({ game, input: { target: v === undefined ? null : Math.round(v * 100) / 100 } });
  const footer = alertsEnabled ? undefined : RNPlatform.OS === 'web' ? 'Alerts arrive in the iOS and Android apps.' : 'Notifications are off. Turn them on in Settings to get these alerts.';

  return (
    <>
      <Group title="Alert me when" footer={footer}>
        <SwitchRow first label="It goes on sale" value={alerts.sale} onChange={(v) => set({ sale: v })} />
        <SwitchRow label="It hits its lowest price" value={alerts.low} onChange={(v) => set({ low: v })} />
        <SwitchRow label="A sale is about to end" detail="24 hours before" value={alerts.ending} onChange={(v) => set({ ending: v })} />
        <SwitchRow label="The price drops at all" detail="Every further drop, even small ones" value={alerts.drop} onChange={(v) => set({ drop: v })} />
        <Row
          label="It reaches my price"
          right={
            <View style={[styles.target, { backgroundColor: c.raised }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                onEndEditing={() => {
                  const v = parseFloat(text.replace(',', '.'));
                  const next = Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
                  if (next === target) return; // nothing changed, nothing to save
                  commitTarget(next);
                }}
                maxFontSizeMultiplier={1.3}
                placeholder={suggested ? (suggested * 0.75).toFixed(currency === 'JPY' ? 0 : 2) : 'Price'}
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
      {target !== undefined ? (
        <Pressable onPress={() => commitTarget(undefined)} style={{ paddingHorizontal: GUTTER + space.xs, paddingTop: space.md }} hitSlop={10} accessibilityRole="button">
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
  target: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 36, borderRadius: radius.sm, width: 132 },
  targetInput: { flex: 1, height: '100%', fontFamily: font.monoMedium, fontSize: 15, textAlign: 'right', minWidth: 60 },
});
