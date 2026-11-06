/**
 * Renders the real app (native code path, not web) against a fake API.
 * Catches crashes that only happen on a phone, like a hook running outside
 * its provider, which unit tests and web screenshots can't see.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { checkServer, useServer } from '../api/server';
import { useSettings } from '../state/settings';
import { useWatchlist } from '../state/watchlist';

// The first render loads every screen of the app. On a cold Jest cache (a fresh
// clone, or after `--no-cache`) that takes well over Jest's 5 second default.
jest.setTimeout(60_000);

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('@shopify/flash-list', () => {
  const { FlatList } = jest.requireActual('react-native');
  return { FlashList: FlatList };
});
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    deleteItemAsync: async (k: string) => void store.delete(k),
  };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  useLastNotificationResponse: () => null,
  clearLastNotificationResponse: jest.fn(),
  getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[test]' }),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));

const game = {
  key: 'sw:eu:1',
  platform: 'switch2',
  title: 'Test Kart',
  publisher: 'Test Co',
  onSale: true,
  maxDiscount: 25,
  nsuids: { europe: '1' },
};
const price = (country: string, currency: string, regular: number, sale?: number) => ({
  country,
  regular: { amount: regular, currency },
  sale: sale !== undefined ? { amount: sale, currency } : undefined,
  discountPercent: sale !== undefined ? Math.round((1 - sale / regular) * 100) : 0,
  checkedAt: Date.now(),
});
const prices = [price('US', 'USD', 80, 60), price('GB', 'GBP', 64, 48)];

let watches: unknown[] = [];
let down = false;
let storesDown = false;
const calls: string[] = [];

function respond(url: string, init?: RequestInit) {
  const raw = new URL(url);
  // Game keys are URL-encoded by the app (sw%3Aeu%3A1); the real server decodes them too
  const u = { pathname: decodeURIComponent(raw.pathname) };
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${u.pathname}`);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  // The phone talking to the stores directly (phone-only mode)
  if (raw.host === 'searching.nintendo-europe.com' || raw.host === 'api.ec.nintendo.com' || raw.host.includes('frankfurter') || raw.host.includes('er-api')) {
    if (storesDown) return Promise.reject(new TypeError('Network request failed'));
    if (raw.host === 'searching.nintendo-europe.com') {
      return json({ response: { numFound: 1, docs: [{ title: 'Offline Kart', nsuid_txt: ['70010000000009'], playable_on_txt: ['BEE'] }] } });
    }
    if (raw.host === 'api.ec.nintendo.com') {
      const country = raw.searchParams.get('country')!;
      const currency = country === 'GB' ? 'GBP' : 'EUR';
      return json({ prices: [{ title_id: 70010000000009, sales_status: 'onsale', regular_price: { currency, raw_value: '40' }, discount_price: { currency, raw_value: '20' } }] });
    }
    return json({ base: 'USD', date: '2026-11-05', rates: { GBP: 0.8, EUR: 0.9 } });
  }
  if (down) return Promise.reject(new TypeError('Network request failed'));
  switch (true) {
    case u.pathname === '/health':
      return json({ ok: true });
    case u.pathname === '/v1/fx':
      return json({ base: 'USD', rates: { USD: 1, GBP: 0.8 }, sources: { USD: 'ecb', GBP: 'ecb' }, asOf: '2026-11-05', updatedAt: Date.now() });
    case u.pathname === '/v1/events':
      return json({ items: [] });
    case u.pathname === '/v1/deals':
    case u.pathname === '/v1/games':
      return json({ items: [{ game, prices }], total: 1, checkedAt: Date.now() });
    case u.pathname === '/v1/games/sw:eu:1':
      return json({ game, prices, lows: [], history: [], trackedSince: Date.now(), unmatched: [], stale: false });
    case u.pathname === '/v1/devices' && method === 'POST':
      return json({ id: 'dev', secret: 'sec' }, 201);
    case u.pathname === '/v1/devices/me':
      return json({ ok: true });
    case u.pathname === '/v1/watches':
      return json({ items: watches });
    case u.pathname.startsWith('/v1/watches/') && method === 'PUT':
      watches = [{ game, prices, alerts: { sale: true, drop: false, target: true, low: true, ending: true }, createdAt: Date.now() }];
      return json({ ok: true });
    case u.pathname === '/v1/activity':
      return json({ items: [] });
    case u.pathname === '/v1/status':
      return json({ sources: [], americasEnabled: false, now: Date.now() });
    default:
      return json({ error: 'not found' }, 404);
  }
}

beforeEach(() => {
  watches = [];
  down = false;
  storesDown = false;
  calls.length = 0;
  useSettings.setState({ serverUrl: 'http://gamely.test:8787', homeRegion: 'GB', homeCurrency: 'USD' });
  useServer.setState({ mode: undefined, lastOk: undefined });
  useWatchlist.setState({ items: {}, removed: [] });
  globalThis.fetch = jest.fn(respond) as unknown as typeof fetch;
});

// Relative to the project root, where Jest runs
const appDir = 'src/app';

it('launches on a phone and shows deals in the home currency', async () => {
  await renderRouter(appDir, { initialUrl: '/' });
  expect(await screen.findByText('Test Kart')).toBeTruthy();
  expect(screen.getAllByText('Deals').length).toBeGreaterThan(0);
  // Registers the install and sends its settings
  await waitFor(() => expect(calls).toContain('PUT /v1/devices/me'));
});

it('opens a game and watches it', async () => {
  await renderRouter(appDir, { initialUrl: '/game/sw:eu:1' });
  await waitFor(() => expect(calls.some((c) => c.includes('/v1/games/'))).toBe(true));
  expect(await screen.findByText('Test Kart')).toBeTruthy();
  expect(await screen.findByText('Every region')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Watch price')));
  await waitFor(() => expect(calls).toContain('PUT /v1/watches/sw:eu:1'));
  expect(await screen.findByText('Alert me when')).toBeTruthy();
});

it('switches to phone-only mode when the server is off', async () => {
  down = true;
  await renderRouter(appDir, { initialUrl: '/' });
  expect(await screen.findByText('Offline Kart', {}, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByText(/phone-only mode/)).toBeTruthy();
}, 15_000);

it('explains the problem when neither the server nor the stores answer', async () => {
  down = true;
  storesDown = true;
  await renderRouter(appDir, { initialUrl: '/' });
  expect(await screen.findByText('Couldn’t load deals', {}, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByText('Can’t reach the Nintendo eShop. Check your connection.')).toBeTruthy();
}, 15_000);

it('keeps a game watched while offline, and syncs it when the server is back', async () => {
  down = true;
  await renderRouter(appDir, { initialUrl: '/game/sw:eu:70010000000009' });
  expect(await screen.findByText('Offline Kart', {}, { timeout: 8000 })).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Watch price')));
  expect(useWatchlist.getState().items['sw:eu:70010000000009']).toBeTruthy();
  expect(calls.some((c) => c.startsWith('PUT /v1/watches/'))).toBe(false);
  // The PC comes back on
  down = false;
  await act(async () => {
    await checkServer();
  });
  await waitFor(() => expect(calls).toContain('PUT /v1/watches/sw:eu:70010000000009'), { timeout: 8000 });
}, 20_000);

it.each(['/directory', '/watchlist', '/settings', '/settings/regions', '/settings/sources'])('renders %s without crashing', async (url) => {
  const r = await renderRouter(appDir, { initialUrl: url });
  expect(r.getPathname()).toBe(url);
});
