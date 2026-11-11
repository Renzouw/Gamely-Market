/**
 * The server's cross-region matches, sent to the phone so phone-only mode
 * can price Japan, Hong Kong, Korea and the Americas too. Matching needs
 * catalogs too big for a phone; the IDs it found are small.
 *
 * Compact text, one game per line: "eu,americas,japan,hongkong,korea,sea".
 * New groups only ever go on the end, so a copy saved before one existed
 * still reads (its lines are just shorter).
 * Full-game IDs all start with 7001, so that prefix is left off (10 digits
 * instead of 14). An empty field means no match in that group.
 */
import type { ShopGroup } from './types';

export type LinkGroup = Exclude<ShopGroup, 'steam' | 'europe'>;
export const LINK_GROUPS: LinkGroup[] = ['americas', 'japan', 'hongkong', 'korea', 'sea'];
export type GameLinks = Partial<Record<LinkGroup, string>>;

const PREFIX = '7001';
const short = (id?: string) => (id ? (id.startsWith(PREFIX) && id.length === 14 ? id.slice(4) : id) : '');
const full = (id: string) => (id.length === 10 ? PREFIX + id : id);

export function encodeLinks(rows: { europe: string; links: GameLinks }[]): string {
  return rows
    .filter((r) => LINK_GROUPS.some((g) => r.links[g]))
    // Empty fields at the end are left off: most games have no match in the newest groups
    .map((r) => [short(r.europe), ...LINK_GROUPS.map((g) => short(r.links[g]))].join(',').replace(/,+$/, ''))
    .join('\n');
}

/** Europe ID → that game's IDs in the other groups. */
export function decodeLinks(text: string): Map<string, GameLinks> {
  const out = new Map<string, GameLinks>();
  for (const line of text.split(/\r?\n/)) {
    const [eu, ...rest] = line.split(',');
    if (!eu) continue;
    const links: GameLinks = {};
    LINK_GROUPS.forEach((g, i) => {
      if (rest[i]) links[g] = full(rest[i]);
    });
    out.set(full(eu), links);
  }
  return out;
}
