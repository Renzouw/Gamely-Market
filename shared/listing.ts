/**
 * What a store listing actually sells. Most are games, but some listings
 * look like games and aren't: a Switch 2 Edition upgrade pack (it needs
 * the Switch game to work) or a Friend's Pass (a free copy that only lets
 * a friend play along with someone who owns the game).
 */
export type ListingKind = 'game' | 'upgrade' | 'friend';

/** Nintendo IDs starting 7005 are add-on content; on a Switch 2 Edition listing that's the upgrade pack. */
const ADD_ON = /^7005\d{10}$/;
const FRIEND_PASS = /friend['’`]?s?\s+pass/i;
const UPGRADE_PACK = /upgrade\s+pack/i;

export function listingKind(g: { key: string; title: string }): ListingKind {
  const id = g.key.startsWith('sw:') ? g.key.split(':')[2] : undefined;
  if ((id && ADD_ON.test(id)) || UPGRADE_PACK.test(g.title)) return 'upgrade';
  if (FRIEND_PASS.test(g.title)) return 'friend';
  return 'game';
}

/** The short tag shown on a listing, and the one line that explains it. */
export const KIND_LABEL: Record<Exclude<ListingKind, 'game'>, { tag: string; explain: string }> = {
  upgrade: { tag: 'Upgrade pack', explain: 'An upgrade pack: it needs the Switch game, bought from the same eShop.' },
  friend: { tag: 'Friend’s Pass', explain: 'A Friend’s Pass: free, but it only lets you play along with a friend who owns the full game.' },
};

/**
 * Games Europe and the Americas don't sell, filed under an Asian store's own listing
 * ("sw:jp:…" from Japan, "sw:sea:…" from Southeast Asia). Japan's are under their
 * Japanese title, and most are in Japanese only.
 */
export function regionOnly(key: string): { tag: string; explain: string } | undefined {
  if (key.startsWith('sw:jp:'))
    return { tag: 'Asia only', explain: 'Not sold in Europe or the Americas. Listed in Japan’s eShop under its Japanese title; it may be in Japanese only, and needs an account from a region that sells it.' };
  if (key.startsWith('sw:sea:'))
    return { tag: 'Asia only', explain: 'Not sold in Europe or the Americas: only in Asia’s eShops, such as the Philippines.' };
  return undefined;
}

/** "Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition" → "Zelda: Tears of the Kingdom" */
export function withoutEdition(title: string): string {
  return title.replace(/\s*[–—-]\s*Nintendo Switch(™)?\s*2 Edition.*$/i, '').replace(/\s+Nintendo Switch(™)?\s*2 Edition.*$/i, '').trim();
}
