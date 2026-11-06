import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type Next } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { DEFAULT_ALERTS, type ApiActivity, type ApiGameDetail, type ApiLinks, type ApiStatus, type ApiWatch, type SourceHealth } from '@shared/api';
import { encodeLinks } from '@shared/links';
import { titleKey } from '@shared/match';
import { convert } from '@shared/pricing';
import { HOME_CURRENCIES, STEAM_REGIONS, SWITCH_REGIONS } from '@shared/regions';
import { americasEnabled, config } from '../config';
import { all, get, placeholders, run, type Db } from '../db';
import { readFx } from '../ingest/fx';
import { searchSteam } from '../sources/steam';
import { attachNsuid, gameIdForNsuid, getGame, lowsFor, nsuidsForGames, pricesFor, rowToGame, rowToPrice, upsertGame, type GameRow, type Group } from '../store';
import { dailyBest, type HistoryRow } from '@shared/history';
import { effectiveRegions, listDeals, searchGames } from './listings';
import { refreshAndAlert } from '../alerts/run';
import { activeEvents } from '../events/run';

interface DeviceRow {
  id: string;
  secret_hash: string;
  last_seen: number;
  currency: string;
  home_region: string;
  switch_regions: string;
  steam_regions: string;
}

type Env = { Variables: { device: DeviceRow } };

const ALL_COUNTRIES = new Set([...SWITCH_REGIONS.map((r) => r.code), ...STEAM_REGIONS.map((r) => r.code)]);
const country = z.string().regex(/^[A-Z]{2}$/).refine((c) => ALL_COUNTRIES.has(c), 'Unknown region');
const currency = z.string().refine((c) => HOME_CURRENCIES.includes(c), 'Unsupported currency');
const switchCountry = z.string().refine((c) => SWITCH_REGIONS.some((r) => r.code === c), 'Unknown eShop');
const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim().toUpperCase()).filter((c) => ALL_COUNTRIES.has(c)) : []);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const SOURCE_LABELS: Record<string, string> = {
  'nintendo-prices': 'Nintendo eShop prices',
  'nintendo-eu-catalog': 'Nintendo Europe catalog',
  'nintendo-us-catalog': 'Nintendo Americas catalog',
  'nintendo-jp-catalog': 'Nintendo Japan catalog',
  'nintendo-hongkong-catalog': 'Nintendo Hong Kong catalog',
  'nintendo-korea-catalog': 'Nintendo Korea catalog',
  'nintendo-hk-titles': 'Nintendo Hong Kong title pages',
  'steam-prices': 'Steam prices',
  'steam-specials': 'Steam specials',
  fx: 'Exchange rates (ECB)',
};

/**
 * The caller's address. X-Forwarded-For is only believed behind a proxy we
 * run (TRUST_PROXY=1); otherwise anyone could pick a fresh address per request.
 */
function clientIp(c: Context): string {
  if (config.trustProxy) {
    const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'local';
}

/** Small fixed-window rate limit per address, so one client can't starve the rest. */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  let lastSweep = 0;
  return async (c: Context, next: Next) => {
    const ip = clientIp(c);
    const now = Date.now();
    // Drop expired windows now and then, instead of wiping everyone's count
    if (now - lastSweep > 60_000) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      lastSweep = now;
    }
    const h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) {
      c.header('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  };
}

export function createApp(db: Db, opts: { onPricesChanged?: () => void } = {}) {
  const app = new Hono<Env>();
  app.use('*', cors());
  app.use('*', compress());
  app.use('/v1/*', rateLimit(240));
  // Registering devices is cheap for a client and costly for us; keep it rare
  const deviceLimit = rateLimit(10);
  app.onError((e, c) => {
    console.error(e);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  /**
   * Re-price a few games on demand, keeping response times bounded. The same
   * game is never refreshed twice at once, and a game is tried at most once
   * per refresh window, so page views can't be used to hammer the stores.
   */
  const inFlight = new Map<string, Promise<unknown>>();
  const lastTried = new Map<string, number>();
  async function refreshNow(ids: string[], timeoutMs: number) {
    const now = Date.now();
    const due = ids.filter((id) => !inFlight.has(id) && now - (lastTried.get(id) ?? 0) > config.refreshOnViewAfterMs);
    const waiting = ids.map((id) => inFlight.get(id)).filter(Boolean) as Promise<unknown>[];
    if (due.length) {
      due.forEach((id) => lastTried.set(id, now));
      if (lastTried.size > 100_000) for (const [k, t] of lastTried) if (now - t > config.refreshOnViewAfterMs) lastTried.delete(k);
      const job = refreshAndAlert(db, due)
        .then(({ changes }) => changes.length && opts.onPricesChanged?.())
        .catch(() => undefined)
        .finally(() => due.forEach((id) => inFlight.delete(id)));
      due.forEach((id) => inFlight.set(id, job));
      waiting.push(job);
    }
    if (!waiting.length) return;
    await Promise.race([Promise.all(waiting), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** When each Steam search last ran, oldest first */
  const steamSearched = new Map<string, number>();
  const STEAM_SEARCH_TTL = 10 * 60_000;

  const requireDevice = async (c: Context<Env>, next: Next) => {
    const [id, secret] = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').split('.');
    const d = id && secret ? get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', id) : undefined;
    const ok = d && timingSafeEqual(Buffer.from(sha256(secret)), Buffer.from(d.secret_hash));
    if (!ok) return c.json({ error: 'Unknown device' }, 401);
    const now = Date.now();
    if (now - d.last_seen > 60_000) run(db, 'UPDATE devices SET last_seen = ? WHERE id = ?', now, d.id);
    c.set('device', d);
    await next();
  };

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/v1/status', (c) => {
    const rows = all<{ source: string; last_ok: number | null; last_error: string | null; last_error_at: number | null }>(db, 'SELECT * FROM source_status');
    const sources: SourceHealth[] = rows.map((r) => ({
      source: r.source,
      label: SOURCE_LABELS[r.source] ?? r.source,
      lastOk: r.last_ok ?? undefined,
      lastError: r.last_error ?? undefined,
      lastErrorAt: r.last_error_at ?? undefined,
      healthy: !!r.last_ok && (!r.last_error_at || r.last_ok > r.last_error_at),
    }));
    const body: ApiStatus = { sources, americasEnabled: americasEnabled(), now: Date.now() };
    return c.json(body);
  });

  app.get('/v1/fx', (c) => {
    const fx = readFx(db);
    if (!fx) return c.json({ error: 'Exchange rates not loaded yet' }, 503);
    c.header('Cache-Control', 'public, max-age=600');
    return c.json(fx);
  });

  app.get('/v1/events', (c) => {
    c.header('Cache-Control', 'public, max-age=120');
    return c.json({ items: activeEvents(db) });
  });

  // Every European game's matches elsewhere, so phone-only mode can price those regions too
  let links: { body: ApiLinks; at: number } | undefined;
  app.get('/v1/links', (c) => {
    if (!links || Date.now() - links.at > 10 * 60_000) {
      const rows = all<{ europe: string; americas: string | null; japan: string | null; hongkong: string | null; korea: string | null }>(
        db,
        `SELECT e.nsuid AS europe,
           (SELECT nsuid FROM game_ids WHERE game_id = e.game_id AND grp = 'americas') AS americas,
           (SELECT nsuid FROM game_ids WHERE game_id = e.game_id AND grp = 'japan') AS japan,
           (SELECT nsuid FROM game_ids WHERE game_id = e.game_id AND grp = 'hongkong') AS hongkong,
           (SELECT nsuid FROM game_ids WHERE game_id = e.game_id AND grp = 'korea') AS korea
         FROM game_ids e WHERE e.grp = 'europe' ORDER BY e.nsuid`,
      );
      const text = encodeLinks(rows.map(({ europe, ...l }) => ({ europe, links: { americas: l.americas ?? undefined, japan: l.japan ?? undefined, hongkong: l.hongkong ?? undefined, korea: l.korea ?? undefined } })));
      links = { body: { rows: text, count: text ? text.split('\n').length : 0, builtAt: Date.now() }, at: Date.now() };
    }
    c.header('Cache-Control', 'public, max-age=600');
    return c.json(links.body);
  });

  app.get('/v1/deals', (c) => {
    const q = z
      .object({
        platform: z.enum(['switch2', 'switch', 'steam']),
        sort: z.enum(['popular', 'discount', 'cheapest', 'ending', 'newest']).default('popular'),
        home: country,
        currency,
        minDiscount: z.coerce.number().min(0).max(100).optional(),
        maxPrice: z.coerce.number().min(0).optional(),
        abroad: z.coerce.number().min(0).max(1).optional(),
        country: switchCountry.optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).optional(),
      })
      .safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'Bad request' }, 400);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(listDeals(db, { ...q.data, regions: csv(c.req.query('regions')) }, readFx(db)));
  });

  app.get('/v1/games', async (c) => {
    const q = z
      .object({
        platform: z.enum(['switch2', 'switch', 'steam', 'all-switch']).default('all-switch'),
        q: z.string().max(100).default(''),
        home: country.default('US'),
        currency: currency.default('USD'),
        country: switchCountry.optional(),
        sort: z.enum(['popular', 'cheapest', 'discount', 'newest', 'title']).optional(),
        onSale: z.enum(['1', 'true']).optional(),
        minDiscount: z.coerce.number().min(0).max(100).optional(),
        maxPrice: z.coerce.number().min(0).optional(),
        abroad: z.coerce.number().min(0).max(1).optional(),
        cursor: z.string().optional(),
      })
      .safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'Bad request' }, 400);
    const { platform, home } = q.data;
    const key = titleKey(q.data.q);
    const asked = csv(c.req.query('regions'));
    const { regions } = effectiveRegions(platform === 'all-switch' ? 'switch' : platform, home, asked);

    // Steam has far too many games to mirror, so search it live and keep what we find.
    // Typing goes past the same words again and again; a search from the last few minutes is still in the database.
    if (platform === 'steam' && key.length >= 2 && !q.data.cursor && !(Date.now() - (steamSearched.get(key) ?? 0) < STEAM_SEARCH_TTL)) {
      try {
        const found = await searchSteam(q.data.q, 'US');
        steamSearched.delete(key);
        steamSearched.set(key, Date.now());
        if (steamSearched.size > 300) steamSearched.delete(steamSearched.keys().next().value!);
        for (const g of found) upsertGame(db, { id: g.key, platform: 'steam', title: g.title, image: g.image, storeUrl: g.storeUrl, steamAppId: g.steamAppId });
        const unpriced = found.map((g) => g.key).filter((id) => !(pricesFor(db, [id], regions).get(id)?.length));
        if (unpriced.length) await refreshNow(unpriced, 5000);
      } catch {
        // Fall through to whatever we already have
      }
    }
    const { q: _text, onSale, ...opts } = q.data;
    const list = searchGames(db, { ...opts, key, regions: asked, onSale: !!onSale }, readFx(db));
    // Quietly top up anything on this page that hasn't been checked lately
    const stale = list.items.filter((i) => !i.prices.length || i.prices.some((p) => Date.now() - p.checkedAt > config.refreshOnViewAfterMs)).map((i) => i.game.key);
    if (stale.length) void refreshNow(stale, 0);
    return c.json(list);
  });

  app.get('/v1/games/:id', async (c) => {
    const id = (c.req.param('id') ?? '');
    const q = z.object({ home: country.default('US'), currency: currency.default('USD') }).safeParse(c.req.query());
    if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'Bad request' }, 400);
    let g = getGame(db, id);
    if (!g) return c.json({ error: 'Game not found' }, 404);

    const { regions, home } = effectiveRegions(g.platform, q.data.home, csv(c.req.query('regions')));
    const nsuids = nsuidsForGames(db, [id]).get(id) ?? {};
    let everywhere = pricesFor(db, [id]).get(id) ?? [];
    let rows = everywhere.filter((r) => regions.includes(r.country));
    // Refresh when what we have is old, when we've never priced it at all, or when it was
    // just linked in a region group (say the Americas) that has no prices yet
    const oldestOf = (list: typeof rows) => (list.length ? Math.min(...list.map((r) => r.checked_at)) : 0);
    const priced = new Set(everywhere.map((r) => r.country));
    const unpricedGroup = g.platform !== 'steam' && (Object.keys(nsuids) as Group[]).some((grp) => {
      const countries = SWITCH_REGIONS.filter((r) => r.group === grp && (grp !== 'americas' || americasEnabled()));
      return countries.length > 0 && !countries.some((r) => priced.has(r.code));
    });
    if (Date.now() - oldestOf(rows.length ? rows : everywhere) > config.refreshOnViewAfterMs || unpricedGroup) {
      await refreshNow([id], 4000);
      g = getGame(db, id)!;
      everywhere = pricesFor(db, [id]).get(id) ?? [];
      rows = everywhere.filter((r) => regions.includes(r.country));
    }

    const fx = readFx(db);
    const now = Date.now();
    // On Steam you can only pay your own store's price: its history and lowest are the ones that count
    const paid = g.platform === 'steam' ? [home] : regions;
    const hist = all<HistoryRow>(
      db,
      `SELECT country, t, currency, price, discount FROM price_history WHERE game_id = ? AND country IN (${placeholders(paid.length)}) ORDER BY t`,
      id,
      ...paid,
    );
    const lows = (lowsFor(db, [id]).get(id) ?? []).filter((l) => regions.includes(l.country));
    let lowest: ApiGameDetail['lowest'];
    for (const l of lows) {
      if (!paid.includes(l.country)) continue;
      const v = convert(l.price, l.currency, q.data.currency, fx);
      if (v !== undefined && (!lowest || v < lowest.price)) lowest = { price: Math.round(v * 100) / 100, country: l.country, at: l.at };
    }
    const groups = new Set(SWITCH_REGIONS.filter((r) => regions.includes(r.code)).map((r) => r.group));
    const unmatched =
      g.platform === 'steam'
        ? []
        : ([...groups].filter((grp) => !nsuids[grp] && (grp !== 'americas' || americasEnabled())) as ApiGameDetail['unmatched']);

    const body: ApiGameDetail = {
      game: rowToGame(g, nsuids),
      prices: rows.map((r) => rowToPrice(r, now)),
      lows,
      history: dailyBest(hist, q.data.currency, fx, now),
      lowest,
      trackedSince: g.created_at,
      unmatched,
      stale: !rows.length || rows.some((r) => now - r.checked_at > config.staleAfterMs),
    };
    return c.json(body);
  });

  /* ------------------------------ devices ------------------------------ */

  app.post('/v1/devices', deviceLimit, (c) => {
    const id = randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const now = Date.now();
    run(db, 'INSERT INTO devices (id, secret_hash, created_at, last_seen) VALUES (?, ?, ?, ?)', id, sha256(secret), now, now);
    return c.json({ id, secret }, 201);
  });

  const settingsSchema = z.object({
    pushToken: z.string().max(200).nullable().optional(),
    os: z.string().max(20).optional(),
    homeRegion: country,
    currency,
    switchRegions: z.array(country).max(60),
    steamRegions: z.array(country).max(60),
    tz: z.string().max(64).default('UTC'),
    quietStart: z.number().int().min(0).max(23).nullable().optional(),
    quietEnd: z.number().int().min(0).max(23).nullable().optional(),
    alertsEnabled: z.boolean(),
    eventAlerts: z
      .object({
        storeSales: z.boolean(),
        bigDeals: z.boolean(),
        platforms: z.array(z.enum(['switch2', 'switch', 'steam'])).max(3),
        minDiscount: z.number().int().min(10).max(95),
      })
      .optional(),
  });

  app.put('/v1/devices/me', requireDevice, async (c) => {
    const s = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!s.success) return c.json({ error: s.error.issues[0]?.message ?? 'Bad request' }, 400);
    const d = c.get('device');
    const v = s.data;
    let tz = v.tz;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      tz = 'UTC';
    }
    // A push token belongs to one install. After a reinstall, take it off the old device row
    // so the phone doesn't get every alert twice.
    if (v.pushToken) run(db, 'UPDATE devices SET push_token = NULL WHERE push_token = ? AND id != ?', v.pushToken, d.id);
    // Target prices are in the device's currency. When it changes, the phone converts
    // them and re-sends every watch (it's the source of truth), so they must not be
    // converted here as well: that turned a $20 target into ¥450,000.
    run(
      db,
      `UPDATE devices SET push_token = COALESCE(?, push_token), os = ?, home_region = ?, currency = ?, switch_regions = ?, steam_regions = ?,
         tz = ?, quiet_start = ?, quiet_end = ?, alerts_enabled = ?, event_alerts = COALESCE(?, event_alerts) WHERE id = ?`,
      v.pushToken ?? null,
      v.os ?? null,
      v.homeRegion,
      v.currency,
      JSON.stringify(v.switchRegions),
      JSON.stringify(v.steamRegions),
      tz,
      v.quietStart ?? null,
      v.quietEnd ?? null,
      v.alertsEnabled ? 1 : 0,
      v.eventAlerts ? JSON.stringify(v.eventAlerts) : null,
      d.id,
    );
    if (v.pushToken === null) run(db, 'UPDATE devices SET push_token = NULL WHERE id = ?', d.id);
    return c.json({ ok: true });
  });

  /* ------------------------------ watches ------------------------------ */

  function watchList(d: DeviceRow): ApiWatch[] {
    const rows = all<{ game_id: string; target: number | null; alerts: string; created_at: number }>(
      db,
      'SELECT game_id, target, alerts, created_at FROM watches WHERE device_id = ? ORDER BY created_at DESC',
      d.id,
    );
    const ids = rows.map((r) => r.game_id);
    const games = new Map(
      (ids.length ? all<GameRow>(db, `SELECT * FROM games WHERE id IN (${placeholders(ids.length)})`, ...ids) : []).map((g) => [g.id, g]),
    );
    const fx = readFx(db);
    const lows = lowsFor(db, ids);
    // One query for every watched game's prices, filtered per game below
    const allPrices = pricesFor(db, ids);
    // The phone prices these itself when the server is off, so it needs every region's ID
    const nsuids = nsuidsForGames(db, ids);
    const switchRegions = JSON.parse(d.switch_regions) as string[];
    const steamRegions = JSON.parse(d.steam_regions) as string[];
    const now = Date.now();
    const out: ApiWatch[] = [];
    for (const r of rows) {
      const g = games.get(r.game_id);
      if (!g) continue;
      const { regions, home } = effectiveRegions(g.platform, d.home_region, g.platform === 'steam' ? steamRegions : switchRegions);
      const prices = (allPrices.get(g.id) ?? []).filter((p) => regions.includes(p.country)).map((p) => rowToPrice(p, now));
      // On Steam you can only pay your own store's price, so its lowest is the one that counts
      const lowRegions = g.platform === 'steam' ? [home] : regions;
      let lowest: ApiWatch['lowest'];
      for (const l of lows.get(g.id) ?? []) {
        if (!lowRegions.includes(l.country)) continue;
        const v = convert(l.price, l.currency, d.currency, fx);
        if (v !== undefined && (!lowest || v < lowest.price)) lowest = { price: Math.round(v * 100) / 100, country: l.country, at: l.at };
      }
      out.push({ game: rowToGame(g, nsuids.get(g.id)), target: r.target ?? undefined, alerts: { ...DEFAULT_ALERTS, ...JSON.parse(r.alerts) }, createdAt: r.created_at, prices, lowest });
    }
    return out;
  }

  app.get('/v1/watches', requireDevice, (c) => c.json({ items: watchList(c.get('device')) }));

  const alertSchema = z.object({ sale: z.boolean(), drop: z.boolean(), target: z.boolean(), low: z.boolean(), ending: z.boolean() }).partial();

  app.put('/v1/watches/:gameId', requireDevice, async (c) => {
    const d = c.get('device');
    const gameId = (c.req.param('gameId') ?? '');
    const body = z
      .object({
        target: z.number().min(0).max(1e9).nullable().optional(),
        alerts: alertSchema.optional(),
        // Sent by the app for games it found on its own (phone-only mode)
        game: z
          .object({
            platform: z.enum(['switch2', 'switch', 'steam']),
            title: z.string().min(1).max(200),
            image: z.string().url().max(500).optional(),
            publisher: z.string().max(200).optional(),
            productCode: z.string().max(20).optional(),
          })
          .optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Bad request' }, 400);
    if (!getGame(db, gameId) && body.data.game) {
      // Only ids the server could have created itself: a Steam app or a European eShop listing
      const steam = gameId.match(/^steam:(\d{1,10})$/);
      const eu = gameId.match(/^sw:eu:(\d{10,20})$/);
      const g = body.data.game;
      if (steam && g.platform === 'steam') {
        upsertGame(db, { id: gameId, platform: 'steam', title: g.title, image: g.image, publisher: g.publisher, steamAppId: Number(steam[1]), storeUrl: `https://store.steampowered.com/app/${steam[1]}/` });
      } else if (eu && g.platform !== 'steam' && !gameIdForNsuid(db, 'europe', eu[1])) {
        upsertGame(db, { id: gameId, platform: g.platform, title: g.title, image: g.image, publisher: g.publisher, productCode: g.productCode });
        attachNsuid(db, 'europe', eu[1], gameId, 'source');
      }
    }
    if (!getGame(db, gameId)) return c.json({ error: 'Game not found' }, 404);
    const existing = get<{ target: number | null; alerts: string }>(db, 'SELECT target, alerts FROM watches WHERE device_id = ? AND game_id = ?', d.id, gameId);
    if (!existing) {
      const count = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM watches WHERE device_id = ?', d.id)?.n ?? 0;
      if (count >= config.maxWatchesPerDevice) return c.json({ error: `You can watch up to ${config.maxWatchesPerDevice} games. Remove one to add another.` }, 409);
    }
    const alerts = { ...DEFAULT_ALERTS, ...(existing ? JSON.parse(existing.alerts) : {}), ...(body.data.alerts ?? {}) };
    const target = body.data.target === undefined ? (existing?.target ?? null) : body.data.target;
    run(
      db,
      `INSERT INTO watches (device_id, game_id, target, alerts, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id, game_id) DO UPDATE SET target = excluded.target, alerts = excluded.alerts`,
      d.id,
      gameId,
      target,
      JSON.stringify(alerts),
      Date.now(),
    );
    // A newly watched game joins the 10-minute refresh set; make sure it starts fresh.
    if (!existing) void refreshNow([gameId], 0);
    return c.json({ ok: true, target: target ?? undefined, alerts });
  });

  app.delete('/v1/watches/:gameId', requireDevice, (c) => {
    run(db, 'DELETE FROM watches WHERE device_id = ? AND game_id = ?', c.get('device').id, (c.req.param('gameId') ?? ''));
    return c.json({ ok: true });
  });

  app.get('/v1/activity', requireDevice, (c) => {
    const rows = all<{ id: number; game_id: string | null; kind: ApiActivity['kind']; title: string; body: string; created_at: number; image: string | null }>(
      db,
      `SELECT n.id, n.game_id, n.kind, n.title, n.body, n.created_at, g.image FROM notifications n
       LEFT JOIN games g ON g.id = n.game_id
       WHERE n.device_id = ? AND NOT (n.status = 'skipped' AND n.error = 'expired')
       ORDER BY n.created_at DESC LIMIT 60`,
      c.get('device').id,
    );
    const items: ApiActivity[] = rows.map((r) => ({
      id: r.id,
      gameId: r.game_id ?? undefined,
      kind: r.kind,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      image: r.image ?? undefined,
    }));
    return c.json({ items });
  });

  return app;
}
