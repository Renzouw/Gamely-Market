import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DeviceRegistration } from '@shared/api';
import { reportServerDown, reportServerOk, serverUrl } from './server';

/** The Gamely server's API. In phone-only mode the app uses src/direct instead. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY = 'gamely.device';
/** Called when this install gets a new identity, so cached device state can be resent. */
const resetListeners = new Set<() => void>();
let device: (DeviceRegistration & { url?: string }) | undefined;
let registering: Promise<DeviceRegistration> | undefined;

type StoredDevice = DeviceRegistration & { url?: string };

async function readStored(): Promise<StoredDevice | undefined> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredDevice) : undefined;
  } catch {
    return undefined;
  }
}

async function store(d: StoredDevice) {
  const raw = JSON.stringify(d);
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, raw);
  else await SecureStore.setItemAsync(KEY, raw);
}

/** This install's identity with the API. Created once, kept in the keychain. */
export async function ensureDevice(): Promise<DeviceRegistration> {
  const url = serverUrl();
  if (device && device.url === url) return device;
  registering ??= (async () => {
    const stored = await readStored();
    // A registration belongs to one server; a new server address means registering again
    if (stored && (stored.url ?? url) === url) return (device = { ...stored, url });
    const res = await fetch(`${url}/v1/devices`, { method: 'POST' });
    if (!res.ok) throw new ApiError(res.status, 'Could not register this device');
    const d: StoredDevice = { ...((await res.json()) as DeviceRegistration), url };
    await store(d);
    resetListeners.forEach((fn) => fn());
    return (device = d);
  })().finally(() => (registering = undefined));
  return registering;
}

type Query = Record<string, string | number | undefined | null | string[]>;

function qs(q?: Query): string {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}


export function onDeviceReset(fn: () => void) {
  resetListeners.add(fn);
  return () => resetListeners.delete(fn);
}

async function forgetDevice(stale: DeviceRegistration) {
  // An old request can come back late; never throw away a newer registration
  if (device && device.id !== stale.id) return;
  device = undefined;
  const stored = await readStored();
  if (stored && stored.id !== stale.id) return;
  if (Platform.OS === 'web') globalThis.localStorage?.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
  resetListeners.forEach((fn) => fn());
}

type ApiOpts = { query?: Query; method?: 'GET' | 'PUT' | 'POST' | 'DELETE'; body?: unknown; auth?: boolean; signal?: AbortSignal };

export async function api<T>(path: string, opts: ApiOpts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let creds: DeviceRegistration | undefined;
  if (opts.auth) {
    creds = await ensureDevice();
    headers.Authorization = `Bearer ${creds.id}.${creds.secret}`;
  }
  let res: Response;
  const base = serverUrl();
  if (!base) throw new ApiError(0, 'No server set up.');
  try {
    res = await fetch(`${base}${path}${qs(opts.query)}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') reportServerDown();
    throw new ApiError(0, 'Can’t reach Gamely. Check your connection.');
  }
  reportServerOk();
  if (res.status === 401 && creds && !retried) {
    // The server no longer knows this install (e.g. its database was reset).
    // Register again and retry once, so the person never sees "Unknown device".
    await forgetDevice(creds);
    return api<T>(path, opts, true);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, res.status >= 500 ? 'Gamely is having trouble right now. Try again in a moment.' : (body.error ?? 'Request failed'));
  }
  return (await res.json()) as T;
}

export function errorText(e: unknown): string {
  // Server errors and store errors (phone-only mode) both carry a message written for people
  if (e instanceof ApiError || (e instanceof Error && e.name === 'StoreError')) return e.message;
  return 'Something went wrong. Try again in a moment.';
}
