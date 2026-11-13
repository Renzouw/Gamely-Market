/**
 * Nintendo's Japan, Hong Kong and Korea catalogs. Their titles are in
 * Japanese, Chinese or Korean, so games are linked to the European catalog
 * by product code (plus platform), never by title. Parsing and request
 * building only; the server does the fetching.
 */
import type { Platform } from '../types';

type SwitchPlatform = Exclude<Platform, 'steam'>;

/** One game as a regional catalog lists it. */
export interface RegionEntry {
  nsuid: string;
  platform: SwitchPlatform;
  /** Platform plus the 4-character product code core, e.g. "BEEAAAC". See codeKey. */
  codeKey: string;
  title: string;
  releaseDate?: string;
  /** Southeast Asia and Japan only: used when a game is sold there and nowhere else we read */
  publisher?: string;
  image?: string;
}

/**
 * Product codes like "BEE-P-AAACA": hardware, type letter, a 4-character
 * core, region letter. The core alone is not unique: Super Mario Odyssey is
 * HAC AAAC and Donkey Kong Bananza is BEE AAAC. So the key is hardware plus
 * core, the same shape productCore() gives for a full European code.
 * A Switch 2 Edition keeps its base game's core but is sold as BEE.
 */
export function codeKey(platform: SwitchPlatform, code: string | null | undefined): string | undefined {
  const core = code?.trim().toUpperCase().match(/^([A-Z0-9]{4})[A-Z0-9]$/)?.[1];
  return core ? `${platform === 'switch2' ? 'BEE' : 'HAC'}${core}` : undefined;
}

/** Full games have IDs starting 7001. DLC is 7005, bundles 7007. */
const GAME_NSUID = /^7001\d{10}$/;

/* ---------------------------------- Japan ---------------------------------- */

export const NINTENDO_JP_SEARCH = 'https://search.nintendo.jp/nintendo_soft/search.json';
/**
 * Southeast Asia's eShop (the Philippines; Singapore, Malaysia and Thailand
 * share its IDs) runs on the same search as Japan, with the same fields, so
 * jpCatalogQuery and parseJpResponse read it too. Games are linked by product
 * code, like Japan, and, since its titles are in English, by an exact title
 * that only one game has (many games have no product code in Europe).
 */
export const NINTENDO_SEA_SEARCH = 'https://search.nintendo.jp/nintendo_soft_ph/search.json';

/**
 * The fields and filter values Nintendo Japan uses. If Nintendo changes
 * them, this is the one place to adjust. "sform" is the sales format:
 * these four are the downloadable games themselves (DLC, sets, amiibo,
 * Virtual Console and so on have their own values).
 */
export const JP_FIELDS = {
  nsuid: 'nsuid',
  code: 'icode', // core + region letter, e.g. "AAACA"
  hardware: 'hard',
  format: 'sform',
  title: 'title',
  date: 'dsdate', // "2025-07-17 00:00:00"
  publisher: 'maker',
  image: 'iurl', // a hash; the picture is at JP_IMAGE + hash + ".jpg"
} as const;
export const JP_IMAGE = 'https://img-eshop.cdn.nintendo.net/i/';
export const JP_GAME_FORMS = ['HAC_DL', 'HAC_DOWNLOADABLE', 'BEE_DL', 'BEE_DOWNLOADABLE'];
const JP_HARDWARE: Record<string, SwitchPlatform> = { '1_HAC': 'switch', '05_BEE': 'switch2' };
export const JP_PAGE_SIZE = 300;

export type JpItem = Partial<Record<(typeof JP_FIELDS)[keyof typeof JP_FIELDS], string | null>>;

export interface JpResponse {
  result?: { total?: number; items?: JpItem[] };
}

/** One page of every downloadable Switch and Switch 2 game, newest first. */
export function jpCatalogQuery(page: number) {
  return { opt_sshow: 1, 'opt_sform[]': JP_GAME_FORMS, limit: JP_PAGE_SIZE, page: page + 1 };
}

/** Only the discounted ones: a page or two in Southeast Asia, about ten in Japan. */
export function jpSaleQuery(page: number) {
  return { ...jpCatalogQuery(page), fq: 'sale_flg_s:1' };
}

export function parseJpItem(it: JpItem): RegionEntry | undefined {
  const nsuid = it[JP_FIELDS.nsuid];
  const platform = JP_HARDWARE[it[JP_FIELDS.hardware] ?? ''];
  if (!nsuid || !GAME_NSUID.test(nsuid) || !platform || !JP_GAME_FORMS.includes(it[JP_FIELDS.format] ?? '')) return undefined;
  const key = codeKey(platform, it[JP_FIELDS.code]);
  if (!key) return undefined;
  const image = it[JP_FIELDS.image];
  return {
    nsuid,
    platform,
    codeKey: key,
    title: it[JP_FIELDS.title] ?? '',
    releaseDate: isoDay(it[JP_FIELDS.date]),
    publisher: it[JP_FIELDS.publisher] || undefined,
    image: image && /^[0-9a-f]{16,}$/i.test(image) ? `${JP_IMAGE}${image}.jpg` : undefined,
  };
}

/**
 * Switch 2 Edition upgrade packs in Southeast Asia and Japan (same search, same
 * fields). The catalog query leaves
 * add-ons out, so they're searched for by name; each carries its Edition's
 * product code, which is how it's tied to the Edition.
 */
export interface UpgradeEntry {
  nsuid: string;
  /** The Edition's key, e.g. "BEEAXN7" */
  codeKey: string;
  title: string;
}

/** What each store calls an upgrade pack, to search for them by name */
export const UPGRADE_SEARCH = { sea: 'upgrade pack', japan: 'アップグレードパス' } as const;
export type UpgradeGroup = keyof typeof UPGRADE_SEARCH;

export function upgradeQuery(grp: UpgradeGroup, page: number) {
  return { q: UPGRADE_SEARCH[grp], limit: JP_PAGE_SIZE, page: page + 1 };
}

/** Add-on IDs start 7005. The name check leaves out other add-ons with "upgrade" in them (item packs, deluxe bundles). */
const ADD_ON_NSUID = /^7005\d{10}$/;
const SWITCH2_UPGRADE = /switch(™)?\s*2\s*edition.*(upgrade\s+pack|アップグレードパス)/i;

export function parseUpgradeResponse(data: JpResponse): { entries: UpgradeEntry[]; total: number; count: number } {
  const items = data.result?.items ?? [];
  const entries: UpgradeEntry[] = [];
  for (const it of items) {
    const nsuid = it[JP_FIELDS.nsuid];
    const title = it[JP_FIELDS.title] ?? '';
    if (!nsuid || !ADD_ON_NSUID.test(nsuid) || JP_HARDWARE[it[JP_FIELDS.hardware] ?? ''] !== 'switch2' || !SWITCH2_UPGRADE.test(title)) continue;
    const key = codeKey('switch2', it[JP_FIELDS.code]);
    if (key) entries.push({ nsuid, codeKey: key, title });
  }
  return { entries, total: data.result?.total ?? items.length, count: items.length };
}

export function parseJpResponse(data: JpResponse): { entries: RegionEntry[]; total: number; count: number } {
  const items = data.result?.items ?? [];
  return { entries: items.map(parseJpItem).filter((e): e is RegionEntry => !!e), total: data.result?.total ?? items.length, count: items.length };
}

/* -------------------------- Hong Kong and Korea --------------------------- */

/**
 * Nintendo's Hong Kong and Korea sites share one software search API. Its
 * paged list ("/api/software", 24 a page) shuffles titles that share a
 * release date between pages, so a crawl of it misses about 1 in 10. The
 * search answers up to 5,000 at a time in a stable order, so we use that.
 */
export const ASIA_SITES = { hongkong: 'hk', korea: 'kr' } as const;
export type AsiaGroup = keyof typeof ASIA_SITES;

export const NINTENDO_SITE = 'https://www.nintendo.com';
export const asiaSearchUrl = (grp: AsiaGroup, base = NINTENDO_SITE) => `${base}/${ASIA_SITES[grp]}/api/search`;

export const ASIA_FIELDS = {
  nsuid: 'nsuid',
  code: 'softCode', // core + region letter, lower case, e.g. "aaaca"
  hardware: 'hardwareCategory',
  title: 'title',
  date: 'releaseDate', // ISO
} as const;
const ASIA_HARDWARE: Record<string, SwitchPlatform> = {
  'Nintendo Switch': 'switch',
  'Nintendo Switch 2': 'switch2',
  'Nintendo Switch 2 Edition': 'switch2',
};
export const ASIA_PAGE_SIZE = 5000;
/** The search stops after this many results, so the oldest titles are read from the other end. */
export const ASIA_MAX_RESULTS = 10_000;

export type AsiaItem = Partial<Record<(typeof ASIA_FIELDS)[keyof typeof ASIA_FIELDS], string | null>>;

export interface AsiaResponse {
  items?: AsiaItem[];
  total?: number;
}

/**
 * "Switch" matches every game through its hardware name. Newest release
 * first; any sort value gives oldest first. Pages count from 1.
 */
export function asiaCatalogQuery(page: number, order: 'newest' | 'oldest' = 'newest') {
  return { k: 'Switch', directory: 'software', size: ASIA_PAGE_SIZE, p: page + 1, sort: order === 'oldest' ? 'old' : undefined };
}

/** Pages needed to read every title: newest first up to the cap, then the rest from the oldest end. */
export function asiaCatalogPlan(total: number): { order: 'newest' | 'oldest'; page: number }[] {
  const plan: { order: 'newest' | 'oldest'; page: number }[] = [];
  for (let p = 0; p * ASIA_PAGE_SIZE < Math.min(total, ASIA_MAX_RESULTS); p++) plan.push({ order: 'newest', page: p });
  for (let p = 0; p * ASIA_PAGE_SIZE < total - ASIA_MAX_RESULTS; p++) plan.push({ order: 'oldest', page: p });
  return plan;
}

export function parseAsiaItem(it: AsiaItem): RegionEntry | undefined {
  const nsuid = it[ASIA_FIELDS.nsuid];
  const platform = ASIA_HARDWARE[it[ASIA_FIELDS.hardware] ?? ''];
  // Unreleased games are listed with a placeholder ID like "000"
  if (!nsuid || !GAME_NSUID.test(nsuid) || !platform) return undefined;
  const key = codeKey(platform, it[ASIA_FIELDS.code]);
  if (!key) return undefined;
  return { nsuid, platform, codeKey: key, title: it[ASIA_FIELDS.title] ?? '', releaseDate: isoDay(it[ASIA_FIELDS.date]) };
}

export function parseAsiaResponse(data: AsiaResponse): { entries: RegionEntry[]; total: number; count: number } {
  const items = data.items ?? [];
  return { entries: items.map(parseAsiaItem).filter((e): e is RegionEntry => !!e), total: data.total ?? items.length, count: items.length };
}

/* ---------------------------- eShop title pages ---------------------------- */

/**
 * The web eShop's title page names the game's application ID, the one ID
 * that is the same in every region. Europe's catalog has it too, so it
 * confirms a Hong Kong listing is the European game even when Europe has no
 * product code. Only Hong Kong's pages carry it; Korea's don't.
 */
export const ESHOP_WEB = 'https://ec.nintendo.com';
export const eshopTitleUrl = (country: string, lang: string, nsuid: string, base = ESHOP_WEB) => `${base}/${country}/${lang}/titles/${nsuid}`;

/**
 * Reads the application ID from a title page. The page embeds the title's
 * data as escaped JSON ("serverFragment"); we only trust it when it is the
 * title we asked for and it names exactly one application.
 *
 * Returns the ID; null when the page is this title's but has no single ID
 * (an answer worth remembering); undefined when the page isn't this title's
 * data at all (an error or challenge page: try again later).
 */
export function parseEshopAppId(html: string, nsuid: string): string | null | undefined {
  const start = html.indexOf('serverFragment');
  if (start < 0) return undefined;
  // The data sits inside a JavaScript string, so its quotes are escaped
  const text = html.slice(start, start + 400_000).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
  const open = text.indexOf('{');
  if (open < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const frag = JSON.parse(text.slice(open, i + 1)) as { nsUid?: number | string; applications?: { id?: string }[] };
        if (String(frag.nsUid) !== nsuid) return undefined;
        const apps = frag.applications ?? [];
        const id = apps.length === 1 ? apps[0].id?.toLowerCase() : undefined;
        return id && /^[0-9a-f]{16}$/.test(id) ? id : null;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/* --------------------------------- helpers --------------------------------- */

function isoDay(s: string | null | undefined): string | undefined {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
