import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, openDb, type Db } from '../src/db';
import { syncEuCatalog, syncUsFullCatalog } from '../src/ingest/catalog';
import { fetchUsCatalog, forgetUsKey, parseUsKey, usHitToGame, type UsHit } from '../src/sources/nintendo/catalogUs';

/**
 * The Americas catalog: Nintendo's US store search (Algolia), with the key
 * read from Nintendo's US store page. Fixtures are real, saved on
 * 2026-11-06: two search results and an excerpt of the page's script with
 * the key replaced by a dummy.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const SCRIPT = fixture('us-store-app.js');
const KEY = '0123456789abcdef0123456789abcdef';
const usBananza = JSON.parse(fixture('us-search.json')).results[0].hits as UsHit[];

describe('reading the Americas catalog', () => {
  it('finds the search key in the store page script', () => {
    expect(parseUsKey(SCRIPT)).toEqual({ appId: 'U3B6GR4UA3', apiKey: KEY });
    expect(parseUsKey('nothing here')).toBeUndefined();
  });

  it('keeps full games and leaves out bundles', () => {
    const [game, bundle] = usBananza.map(usHitToGame);
    expect(game).toMatchObject({ key: 'sw:us:70010000096809', platform: 'switch2', title: 'Donkey Kong™ Bananza', publisher: 'Nintendo', nsuids: { americas: '70010000096809' } });
    expect(game?.listPrice?.regular).toEqual({ amount: 69.99, currency: 'USD' });
    expect(bundle).toBeUndefined();
  });
});

/* ------------------------------ a fake store ------------------------------ */

interface Item {
  nsuid: string;
  title: string;
  price: number;
  contentRatingCode?: string;
  playerCount?: string;
  corePlatforms: string[];
  topLevelFilters: string[];
  softwarePublisher?: string;
  releaseDate?: string;
}

let items: Item[];
let algoliaKey: string;
let pageReads: number;

/** Enough of Algolia's filter syntax for what the adapter sends. */
function matches(it: Item, filters: string): boolean {
  return filters.split(' AND ').every((clause) => {
    const num = clause.match(/^price\.finalPrice (>=|<) ([\d.]+)$/);
    if (num) return num[1] === '>=' ? it.price >= Number(num[2]) : it.price < Number(num[2]);
    const facet = clause.match(/^(NOT )?(\w+):"(.*)"$/);
    if (!facet) throw new Error(`unexpected filter ${clause}`);
    const v = (it as unknown as Record<string, unknown>)[facet[2]];
    const has = Array.isArray(v) ? v.includes(facet[3]) : v === facet[3];
    return facet[1] ? !has : has;
  });
}

function algolia(body: string, key: string | null): Response {
  if (key !== algoliaKey) return new Response('{"message":"Invalid API key"}', { status: 403 });
  const p = new URLSearchParams(JSON.parse(body).requests[0].params);
  const found = items.filter((it) => matches(it, p.get('filters') ?? ''));
  const per = Number(p.get('hitsPerPage'));
  const page = Number(p.get('page') ?? 0);
  // Like Algolia, never more than 1,000 results for one search
  const hits = found.slice(0, 1000).slice(page * per, page * per + per);
  const facets: Record<string, Record<string, number>> = {};
  for (const f of JSON.parse(p.get('facets') ?? '[]') as string[]) {
    facets[f] = {};
    for (const it of found) {
      const v = (it as unknown as Record<string, unknown>)[f];
      for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) facets[f][x as string] = (facets[f][x as string] ?? 0) + 1;
    }
  }
  return new Response(JSON.stringify({ results: [{ nbHits: found.length, hits: hits.map((h) => ({ ...h, price: { finalPrice: h.price, regPrice: h.price } })), facets }] }));
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  forgetUsKey();
  algoliaKey = KEY;
  pageReads = 0;
  items = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.host === 'www.nintendo.com' && u.pathname === '/us/store/games/') {
        pageReads++;
        return new Response('<script src="/us/_next/static/chunks/pages/_app-82d5baf5de9c0ad2.js"></script>');
      }
      if (u.host === 'www.nintendo.com' && u.pathname.startsWith('/us/_next/')) return new Response(SCRIPT);
      if (u.host === 'u3b6gr4ua3-dsn.algolia.net') return algolia(String(init?.body), new Headers(init?.headers).get('X-Algolia-API-Key'));
      if (u.host === 'searching.nintendo-europe.com') {
        return new Response(JSON.stringify({ response: { numFound: 1, docs: [{ title: 'Donkey Kong Bananza', nsuid_txt: ['70010000096810'], playable_on_txt: ['BEE'], publisher: 'Nintendo', dates_released_dts: ['2025-07-17T00:00:00Z'] }] } }));
      }
      return new Response('not found', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const make = (n: number, over: Partial<Item>, start: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ nsuid: String(70010000000000 + start + i), title: `Game ${start + i}`, price: 9.99, contentRatingCode: 'E', playerCount: 'Single player', corePlatforms: ['Nintendo Switch'], topLevelFilters: [], ...over }));

describe('the whole Americas catalog, past the 1,000-result limit', () => {
  it('reads every game by slicing on price, then rating and player count', async () => {
    items = [
      // 2,700 games at one price: more than one search can return, even within one rating
      ...make(1300, { price: 4.99, contentRatingCode: 'E', playerCount: 'Single player' }, 0),
      ...make(400, { price: 4.99, contentRatingCode: 'E', playerCount: '2+' }, 1300),
      ...make(600, { price: 4.99, contentRatingCode: 'T' }, 1700),
      ...make(400, { price: 4.99, contentRatingCode: undefined }, 2300),
      // Spread across other prices
      ...Array.from({ length: 1500 }, (_, i) => make(1, { price: (i % 60) + 0.49 }, 3000 + i)[0]),
      // DLC is left out
      ...make(300, { price: 1.99, topLevelFilters: ['DLC'] }, 5000),
    ];
    const seen: string[] = [];
    const res = await fetchUsCatalog((games) => seen.push(...games.map((g) => g.nsuids!.americas!)));
    // The 1,300 E-rated single-player games at $4.99 are split by platform last, and still too many:
    // the adapter reads the first 1,000 and reports the rest rather than looping
    expect(res.truncated).toBe(300);
    expect(new Set(seen).size).toBe(4200 - 300);
    expect(seen.some((n) => Number(n) >= 70010000005000)).toBe(false);
  });

  it('reads the key again when Nintendo changes it', async () => {
    items = make(5, {}, 0);
    await fetchUsCatalog();
    expect(pageReads).toBe(1);
    // Nintendo rotates the key; the page now shows the new one
    algoliaKey = 'fedcba9876543210fedcba9876543210';
    const rotated = SCRIPT.replace(KEY, algoliaKey);
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (new URL(url).pathname.startsWith('/us/_next/') ? new Response(rotated) : base(url, init))));
    const res = await fetchUsCatalog();
    expect(res.games).toBe(5);
    expect(pageReads).toBe(2);
  });

  it('links a US listing to the European game by the strict title rule, and skips bundles', async () => {
    await syncEuCatalog(db, { platform: 'switch2', onSaleOnly: false });
    items = usBananza.map((h) => ({
      nsuid: h.nsuid!,
      title: h.title!,
      price: h.price!.finalPrice!,
      corePlatforms: h.corePlatforms!,
      topLevelFilters: h.topLevelFilters ?? [],
      softwarePublisher: h.softwarePublisher,
      releaseDate: h.releaseDate,
      platform: h.platform,
    })) as Item[];
    await syncUsFullCatalog(db);
    expect(all(db, "SELECT grp, nsuid, match_method FROM game_ids WHERE game_id = 'sw:eu:70010000096810' ORDER BY grp")).toEqual([
      { grp: 'americas', nsuid: '70010000096809', match_method: 'title_publisher' },
      { grp: 'europe', nsuid: '70010000096810', match_method: 'source' },
    ]);
    expect(all(db, "SELECT COUNT(*) AS n FROM games WHERE id LIKE 'sw:us:%'")).toEqual([{ n: 0 }]);
  });
});
