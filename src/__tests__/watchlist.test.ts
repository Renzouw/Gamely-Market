import { appendPoint, targetJustHit, useWatchlist, type WatchItem } from '../state/watchlist';
import { sparkPath } from '../components/Sparkline';
import type { Game } from '../domain/types';

const game: Game = { key: 'steam:1', platform: 'steam', title: 'Test', steamAppId: 1 };
const item = (over: Partial<WatchItem>): WatchItem => ({ game, addedAt: 0, history: [], ...over });

describe('price history', () => {
  it('replaces readings inside the same 3 hour window', () => {
    let h = appendPoint([], { t: 0, best: 10, country: 'US' });
    h = appendPoint(h, { t: 60_000, best: 9, country: 'US' });
    expect(h).toEqual([{ t: 60_000, best: 9, country: 'US' }]);
    h = appendPoint(h, { t: 4 * 3600_000, best: 8, country: 'MX' });
    expect(h).toHaveLength(2);
  });
});

describe('target alerts', () => {
  it('fires when the price first crosses the target', () => {
    expect(targetJustHit(item({ target: 20, lastBest: 25 }), 19)).toBe(true);
    expect(targetJustHit(item({ target: 20 }), 20)).toBe(true);
  });
  it("doesn't repeat while the price stays put", () => {
    expect(targetJustHit(item({ target: 20, lastBest: 19 }), 19)).toBe(false);
  });
  it('fires again on a further drop', () => {
    expect(targetJustHit(item({ target: 20, lastBest: 19 }), 15)).toBe(true);
  });
  it('never fires without a target or above it', () => {
    expect(targetJustHit(item({}), 1)).toBe(false);
    expect(targetJustHit(item({ target: 20, lastBest: 30 }), 21)).toBe(false);
  });
});

describe('watchlist store', () => {
  it('adds, records and tracks the lowest price', () => {
    const s = useWatchlist.getState();
    s.add(game, 15);
    expect(useWatchlist.getState().record(game.key, 20, 'US', 0)).toBe(false);
    expect(useWatchlist.getState().record(game.key, 14, 'BR', 4 * 3600_000)).toBe(true);
    const it = useWatchlist.getState().items[game.key];
    expect(it.lowest).toBe(14);
    expect(it.lastCountry).toBe('BR');
    expect(it.history).toHaveLength(2);
    s.remove(game.key);
    expect(useWatchlist.getState().items[game.key]).toBeUndefined();
  });
});

describe('sparkline', () => {
  it('draws a step path that ends at the latest point', () => {
    const { d, last } = sparkPath(
      [
        { t: 0, best: 10, country: 'US' },
        { t: 10, best: 5, country: 'US' },
      ],
      108,
      58,
    );
    expect(d.startsWith('M4.0,4.0')).toBe(true);
    expect(last).toEqual({ x: 104, y: 54 });
  });
  it('draws nothing for a single point', () => {
    expect(sparkPath([{ t: 0, best: 1, country: 'US' }], 100, 50).d).toBe('');
  });
});
