import { create } from 'zustand';
import { useSettings } from '../state/settings';

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

let checking: { url: string; result: Promise<DataMode> } | undefined;

/** Ask the server if it's there. Quick: gives up after a few seconds. */
export function checkServer(): Promise<DataMode> {
  const url = serverUrl();
  // Share a check already on its way, unless the address has changed since
  if (checking?.url === url) return checking.result;
  const result = (async (): Promise<DataMode> => {
    let ok = false;
    if (url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`${url}/health`, { signal: ctrl.signal });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(t);
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

/** A server request just failed at the network level: switch to phone-only mode now. */
export function reportServerDown() {
  useServer.setState({ mode: 'direct', lastCheck: Date.now() });
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
