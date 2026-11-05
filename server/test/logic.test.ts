import { describe, expect, it } from 'vitest';
import { pickMatch, publisherKey } from '../src/ingest/match';
import { nextSendTime, planAlerts, planEnding, type DeviceCtx, type WatchCtx } from '../src/alerts/plan';
import { dailyBest } from '../src/api/history';
import { mergeFx } from '../src/sources/fx';
import { buildMessages } from '../src/push/dispatch';
import type { GameRow, PriceRow } from '../src/store';
import { DEFAULT_ALERTS } from '@shared/api';
import type { FxRates } from '@shared/types';

const row = (over: Partial<GameRow>): GameRow => ({
  id: 'sw:eu:1',
  platform: 'switch',
  title: 'Game',
  title_key: 'game',
  image: null,
  publisher: null,
  release_date: null,
  product_code: null,
  store_url: null,
  steam_app_id: null,
  rank: null,
  on_sale: 0,
  max_discount: 0,
  sale_ends_at: null,
  created_at: 0,
  updated_at: 0,
  ...over,
});

describe('cross-region matching', () => {
  it('matches on product code first', () => {
    const m = pickMatch({ title: 'Game', productCode: 'HACPABCDE' }, [row({ product_code: 'HACPABCDB' })]);
    expect(m?.method).toBe('product_code');
  });

  it('rejects when product codes disagree, even with the same title and publisher', () => {
    expect(pickMatch({ title: 'Game', productCode: 'HACPAAAAE', publisher: 'Nintendo' }, [row({ product_code: 'HACPBBBBB', publisher: 'Nintendo' })])).toBeUndefined();
  });

  it('matches on title plus publisher, ignoring regional suffixes', () => {
    expect(publisherKey('BANDAI NAMCO Entertainment America Inc.')).toBe('bandai namco');
    const m = pickMatch({ title: 'Game', publisher: 'BANDAI NAMCO Entertainment America Inc.' }, [row({ publisher: 'Bandai Namco Entertainment Europe' })]);
    expect(m?.method).toBe('title_publisher');
  });

  it('matches on title plus a close release date', () => {
    expect(pickMatch({ title: 'Game', releaseDate: '2025-06-05' }, [row({ release_date: '2025-06-05T00:00:00Z' })])?.method).toBe('title_date');
    expect(pickMatch({ title: 'Game', releaseDate: '2019-06-05' }, [row({ release_date: '2025-06-05T00:00:00Z' })])).toBeUndefined();
  });

  it('refuses a title-only match', () => {
    expect(pickMatch({ title: 'Game' }, [row({})])).toBeUndefined();
  });

  it('refuses when two candidates are equally good', () => {
    const a = row({ id: 'a', publisher: 'Acme' });
    const b = row({ id: 'b', publisher: 'Acme' });
    expect(pickMatch({ title: 'Game', publisher: 'Acme' }, [a, b])).toBeUndefined();
  });
});

const fx: FxRates = { base: 'USD', rates: { USD: 1, MXN: 20, GBP: 0.8, EUR: 0.9, ZAR: 18 }, updatedAt: 0 };
const device: DeviceCtx = { id: 'd1', currency: 'USD', homeRegion: 'GB', switchRegions: ['GB', 'DE', 'ZA'], steamRegions: ['US'] };
const watch = (over: Partial<WatchCtx> = {}): WatchCtx => ({ gameId: 'g', title: 'Zelda', platform: 'switch', alerts: { ...DEFAULT_ALERTS }, ...over });
const p = (country: string, currency: string, regular: number, sale: number | null = null, ends: string | null = null): PriceRow => ({
  game_id: 'g',
  country,
  currency,
  regular,
  sale,
  discount: sale ? Math.round((1 - sale / regular) * 100) : 0,
  sale_ends_at: ends,
  checked_at: 0,
  changed_at: 0,
});

describe('alert planning', () => {
  const before = [p('GB', 'GBP', 40), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];

  it('announces a sale that starts in one of your regions', () => {
    const after = [p('GB', 'GBP', 40, 20, '2099-01-01T00:00:00Z'), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    const a = planAlerts({ device, watch: watch(), before, after, newLowCountries: [], fx });
    expect(a?.kind).toBe('sale');
    expect(a?.title).toBe('Zelda is on sale');
    expect(a?.body).toContain('50% off');
    expect(a?.body).toContain('United Kingdom');
  });

  it("stays quiet about a sale in a region you don't buy from", () => {
    const after = [...before, p('MX', 'MXN', 1000, 100)];
    expect(planAlerts({ device, watch: watch(), before, after, newLowCountries: [], fx })).toBeUndefined();
  });

  it('prefers the target alert over the sale alert', () => {
    const after = [p('GB', 'GBP', 40, 16), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    const a = planAlerts({ device, watch: watch({ target: 25 }), before, after, newLowCountries: ['GB'], fx });
    expect(a?.kind).toBe('target');
  });

  it("doesn't repeat the target alert while the price stays under it", () => {
    const under = [p('GB', 'GBP', 40, 16), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    const lower = [p('GB', 'GBP', 40, 15), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    const a = planAlerts({ device, watch: watch({ target: 25, alerts: { ...DEFAULT_ALERTS, drop: false, low: false } }), before: under, after: lower, newLowCountries: [], fx });
    expect(a).toBeUndefined();
  });

  it('reports a further drop only when asked to', () => {
    const onSale = [p('GB', 'GBP', 40, 30), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    const deeper = [p('GB', 'GBP', 40, 24), p('DE', 'EUR', 45), p('ZA', 'ZAR', 720)];
    expect(planAlerts({ device, watch: watch({ alerts: { ...DEFAULT_ALERTS, low: false } }), before: onSale, after: deeper, newLowCountries: [], fx })).toBeUndefined();
    const a = planAlerts({ device, watch: watch({ alerts: { ...DEFAULT_ALERTS, low: false, drop: true } }), before: onSale, after: deeper, newLowCountries: [], fx });
    expect(a?.kind).toBe('drop');
  });

  it('only considers the Steam store country you buy in', () => {
    const steamDevice = { ...device, homeRegion: 'US' };
    const w = watch({ platform: 'steam' });
    const b = [p('US', 'USD', 60), p('AR', 'USD', 30)];
    const a = [p('US', 'USD', 60), p('AR', 'USD', 30, 10)];
    expect(planAlerts({ device: steamDevice, watch: w, before: b, after: a, newLowCountries: [], fx })).toBeUndefined();
  });

  it('reminds you once when a sale is about to end', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    const rows = [p('GB', 'GBP', 40, 20, '2026-11-05T10:00:00Z'), p('DE', 'EUR', 45)];
    const a = planEnding({ device, watch: watch(), rows, fx, now });
    expect(a?.kind).toBe('ending');
    expect(a?.body).toContain('10h');
    expect(a?.dedupeKey).toContain('2026-11-05T10:00:00Z');
    expect(planEnding({ device, watch: watch(), rows: [p('GB', 'GBP', 40, 20, '2026-11-09T00:00:00Z')], fx, now })).toBeUndefined();
  });
});

describe('quiet hours', () => {
  const at = (iso: string) => Date.parse(iso);
  it('sends right away outside quiet hours', () => {
    expect(nextSendTime(at('2026-11-05T15:00:00Z'), 'UTC', 22, 8)).toBe(at('2026-11-05T15:00:00Z'));
  });
  it('waits until quiet hours end, across midnight', () => {
    expect(nextSendTime(at('2026-11-05T23:30:00Z'), 'UTC', 22, 8)).toBe(at('2026-11-06T08:00:00Z'));
    expect(nextSendTime(at('2026-11-06T03:15:00Z'), 'UTC', 22, 8)).toBe(at('2026-11-06T08:00:00Z'));
  });
  it("uses the person's time zone", () => {
    // 06:00 UTC is 22:00 the day before in Los Angeles (PST)
    expect(nextSendTime(at('2026-11-06T06:00:00Z'), 'America/Los_Angeles', 22, 7)).toBe(at('2026-11-06T15:00:00Z'));
  });
});

describe('price history', () => {
  const DAY = 86400_000;
  it('takes the lowest price each day across regions, at today’s rates', () => {
    const t0 = Date.parse('2026-11-01T12:00:00Z');
    const pts = dailyBest(
      [
        { country: 'GB', t: t0, currency: 'GBP', price: 40 }, // $50
        { country: 'DE', t: t0, currency: 'EUR', price: 36 }, // $40
        { country: 'GB', t: t0 + 2 * DAY, currency: 'GBP', price: 16 }, // $20
        { country: 'GB', t: t0 + 2 * DAY + 3600_000, currency: 'GBP', price: 40 },
      ],
      'USD',
      fx,
      t0 + 3 * DAY,
    );
    expect(pts.map((x) => x.best)).toEqual([40, 40, 20, 40]);
    expect(pts[2].country).toBe('GB');
  });
});

describe('exchange rates', () => {
  it('prefers ECB rates and labels the fallback ones', () => {
    const q = mergeFx({ base: 'USD', date: '2026-11-04', rates: { EUR: 0.9, MXN: 20 } }, { result: 'success', rates: { EUR: 0.95, ARS: 1000 } }, ['EUR', 'MXN', 'ARS', 'CLP']);
    const by = Object.fromEntries(q.map((x) => [x.currency, x]));
    expect(by.EUR).toMatchObject({ perUsd: 0.9, source: 'ecb' });
    expect(by.ARS).toMatchObject({ perUsd: 1000, source: 'market' });
    expect(by.CLP).toBeUndefined();
    expect(by.USD.perUsd).toBe(1);
  });
  it('refuses a response that is not USD-based', () => {
    expect(() => mergeFx({ base: 'EUR', rates: { USD: 1.1 } }, undefined, [])).toThrow();
  });
});

describe('push batching', () => {
  const n = (id: number, device: string) => ({ id, device_id: device, game_id: `g${id}`, kind: 'sale', title: `Game ${id} is on sale`, body: 'b', data: '{}', expires_at: null, push_token: `ExponentPushToken[${device}]`, alerts_enabled: 1 });
  it('sends individual alerts when there are only a few', () => {
    expect(buildMessages([n(1, 'a'), n(2, 'a')])).toHaveLength(2);
  });
  it('rolls four or more into one summary per person', () => {
    const msgs = buildMessages([n(1, 'a'), n(2, 'a'), n(3, 'a'), n(4, 'a'), n(5, 'b')]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].message.title).toBe('4 price alerts from your watchlist');
    expect(msgs[0].message.body).toBe('Game 1, Game 2, Game 3 and 1 more.');
    expect(msgs[0].ids).toEqual([1, 2, 3, 4]);
  });
});
