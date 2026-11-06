import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiLinks } from '@shared/api';
import { decodeLinks, type GameLinks } from '@shared/links';
import type { Game } from '@shared/types';
import { api } from '../api/client';

/**
 * The server's cross-region matches, kept on the phone so phone-only mode
 * can still price Japan, Hong Kong, Korea and the Americas for games the
 * server has matched. Downloaded while the server is reachable, at most
 * once a day (about 130 KB). Stored in pieces: Android can't read back one
 * stored value much over 2 MB.
 */
const META = 'gamely.links.meta';
const CHUNK = 'gamely.links.';
const LINES_PER_CHUNK = 4000;
const REFRESH_MS = 24 * 3600_000;

let map: Map<string, GameLinks> | undefined;
let loading: Promise<Map<string, GameLinks>> | undefined;

interface Meta {
  chunks: number;
  syncedAt: number;
}

async function readMeta(): Promise<Meta | undefined> {
  try {
    const raw = await AsyncStorage.getItem(META);
    return raw ? (JSON.parse(raw) as Meta) : undefined;
  } catch {
    return undefined;
  }
}

/** The stored matches, read once per app run. */
export function loadLinks(): Promise<Map<string, GameLinks>> {
  if (map) return Promise.resolve(map);
  loading ??= (async () => {
    const meta = await readMeta();
    if (!meta?.chunks) return (map = new Map());
    const parts = await AsyncStorage.multiGet(Array.from({ length: meta.chunks }, (_, i) => CHUNK + i));
    return (map = decodeLinks(parts.map(([, v]) => v ?? '').join('\n')));
  })().catch(() => (map = new Map()));
  return loading;
}

/** Store a fresh copy from the server. */
export async function rememberLinks(rows: string, now = Date.now()): Promise<void> {
  const lines = rows ? rows.split('\n') : [];
  const chunks: [string, string][] = [];
  for (let i = 0; i * LINES_PER_CHUNK < lines.length; i++) chunks.push([CHUNK + i, lines.slice(i * LINES_PER_CHUNK, (i + 1) * LINES_PER_CHUNK).join('\n')]);
  const old = await readMeta();
  await AsyncStorage.multiSet([...chunks, [META, JSON.stringify({ chunks: chunks.length, syncedAt: now } satisfies Meta)]]);
  // Drop pieces left over from a longer copy
  if (old && old.chunks > chunks.length) await AsyncStorage.multiRemove(Array.from({ length: old.chunks - chunks.length }, (_, i) => CHUNK + (chunks.length + i)));
  map = decodeLinks(rows);
  loading = Promise.resolve(map);
}

/** While the server is reachable: refresh the copy if it's a day old. Failures just wait for next time. */
export async function syncLinks(now = Date.now()): Promise<void> {
  const meta = await readMeta();
  if (meta && now - meta.syncedAt < REFRESH_MS) return;
  try {
    const res = await api<ApiLinks>('/v1/links');
    await rememberLinks(res.rows, now);
  } catch {
    // Next launch tries again
  }
}

/** Adds the IDs the server found for these games (European listings only). */
export async function withKnownIds<T extends Pick<Game, 'key' | 'nsuids'>>(games: T[]): Promise<T[]> {
  if (!games.some((g) => g.key.startsWith('sw:eu:'))) return games;
  const links = await loadLinks();
  if (!links.size) return games;
  return games.map((g) => {
    const eu = g.key.startsWith('sw:eu:') ? (g.nsuids?.europe ?? g.key.slice(6)) : undefined;
    const known = eu ? links.get(eu) : undefined;
    return known ? { ...g, nsuids: { ...known, ...g.nsuids } } : g;
  });
}

/** For tests */
export function forgetLinks() {
  map = undefined;
  loading = undefined;
}
