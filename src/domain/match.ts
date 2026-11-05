/**
 * Titles differ a little between eShop regions ("Pokémon™ Scarlet" vs
 * "Pokemon Scarlet"). This turns a title into a key we can compare.
 * Edition names stay in the key, because a Switch 2 Edition is a
 * different product with its own price.
 */
export function titleKey(title: string): string {
  return title
    .replace(/[\u2122\u00ae\u00a9]/g, '') // strip before NFKD, which would turn the TM sign into "TM"
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, ''); // only a leading article, so "Z-A" keeps its "a"
}

/**
 * Nintendo product codes look like "HACPAAAAA" or "BEEPAAAAA".
 * The 4 characters before the region letter identify the game across regions.
 */
export function productCore(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const m = clean.match(/^(HAC|BEE)[A-Z]([A-Z0-9]{4})[A-Z0-9]$/);
  return m ? `${m[1]}${m[2]}` : undefined;
}
