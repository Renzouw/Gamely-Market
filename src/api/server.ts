import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettings } from '../state/settings';
import { persistStorage } from '../state/storage';

/**
 * Where the Gamely server lives, and whether it's reachable right now.
 * When it isn't, the app switches to phone-only mode and talks to the
 * stores directly. It switches back on its own once the server answers.
 */

export const DEFAULT_SERVER_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export function serverUrl(): string {
  return (useSettings.getState().serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/$/, '');
}

export type DataMode = 'server' | 'direct';

interface ServerState {
  /** Unknown until the first check finishes */
  mode: DataMode | undefined;
  lastOk?: number;
  lastCheck?: number;
}

export const useServer = create<ServerState>(() => ({ mode: undefined }));

/**
 * The mode the app ended up in last time. Lists are saved to disk under it,
 * so screens can show them at once while the first check is still running.
 */
export const useLastMode = create<{ mode?: DataMode }>()(persist(() => ({}), { name: 'gamely.lastMode', storage: persistStorage }));
useServer.subscribe((s) => {
  if (s.mode && s.mode !== useLastMode.getState().mode) useLastMode.setState({ mode: s.mode });
});

let checking: { url: string; result: Promise<DataMode> } | undefined;

/** One request to /health; false if it fails or takes longer than `ms`. */
async function ping(url: string, ms: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return (await fetch(`${url}/health`, { signal: ctrl.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ask the server if it's there. While connected, losing it takes two failed tries
 * (6 seconds each, a second apart): a busy moment on the PC or a blip on the phone's
 * Wi-Fi shouldn't drop the whole app into phone-only mode. Otherwise one try is
 * enough, so a launch away from home doesn't wait long.
 */
export function checkServer(): Promise<DataMode> {
  const url = serverUrl();
  // Share a check already on its way, unless the address has changed since
  if (checking?.url === url) return checking.result;
  const result = (async (): Promise<DataMode> => {
    let ok = false;
    if (url) {
      const connected = useServer.getState().mode === 'server';
      ok = await ping(url, connected ? 6000 : 5000);
      if (!ok && connected) {
        await new Promise((r) => setTimeout(r, 1000));
        ok = await ping(url, 6000);
      }
    }
    const now = Date.now();
    if (serverUrl() !== url) return useServer.getState().mode ?? 'direct'; // a newer check owns the answer
    useServer.setState({ mode: ok ? 'server' : 'direct', lastCheck: now, ...(ok ? { lastOk: now } : {}) });
    return ok ? 'server' : 'direct';
  })();
  const entry = { url, result };
  checking = entry;
  void result.finally(() => {
    if (checking === entry) checking = undefined;
  });
  return result;
}

/** The current mode, checking first if we don't know yet. */
export async function currentMode(): Promise<DataMode> {
  return useServer.getState().mode ?? checkServer();
}

/**
 * A server request just failed at the network level. That alone isn't proof the server
 * is gone (the phone may have just woken up or changed networks), so check properly;
 * phone-only mode starts only if that check fails too.
 */
export function reportServerDown() {
  if (useServer.getState().mode === 'server') void checkServer();
  else useServer.setState({ mode: 'direct', lastCheck: Date.now() });
}

export function reportServerOk() {
  useServer.setState({ mode: 'server', lastOk: Date.now() });
}

/**
 * The server is handling alerts for this phone: it's been reachable
 * recently and can send push notifications. Phone-side checks then stay
 * quiet so you never get the same alert twice.
 */
export function serverHandlesPush(pushAvailable: boolean): boolean {
  const { mode, lastOk } = useServer.getState();
  return pushAvailable && mode === 'server' && !!lastOk && Date.now() - lastOk < 30 * 60_000;
}
