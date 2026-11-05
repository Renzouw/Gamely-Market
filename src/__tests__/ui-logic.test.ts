import { chartGeometry } from '../components/PriceChart';
import { ago, initials } from '../lib/format';

describe('chart geometry', () => {
  const pts = [
    { t: 0, best: 40, country: 'GB' },
    { t: 10, best: 20, country: 'GB' },
    { t: 20, best: 30, country: 'GB' },
  ];
  it('draws a step line and marks the lowest point', () => {
    const g = chartGeometry(pts, 200, 120)!;
    expect(g.line.startsWith('M0,10.0')).toBe(true);
    expect(g.lowIdx).toBe(1);
    expect(g.xy[1]).toEqual({ x: 100, y: 110 });
  });
  it('needs at least two points', () => {
    expect(chartGeometry(pts.slice(0, 1), 200)).toBeUndefined();
  });
});

describe('formatting', () => {
  it('describes how long ago something happened', () => {
    const now = 10_000_000;
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(ago(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(ago(undefined)).toBeUndefined();
  });
  it('makes initials for cover placeholders', () => {
    expect(initials('The Legend of Zelda')).toBe('LZ');
    expect(initials('Hades II')).toBe('HI');
  });
});
