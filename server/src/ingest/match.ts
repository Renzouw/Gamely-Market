import { productCore, titleKey } from '@shared/match';
import type { GameRow } from '../store';

export interface MatchInput {
  title: string;
  publisher?: string;
  releaseDate?: string;
  productCode?: string;
}

export type MatchMethod = 'product_code' | 'title_publisher' | 'title_date';

const RANK: Record<MatchMethod, number> = { product_code: 3, title_publisher: 2, title_date: 1 };
const SUFFIXES = /\b(inc|ltd|llc|co|corp|corporation|limited|gmbh|sa|srl|bv|ab|kk|america|americas|europe|eu|uk|us|usa|entertainment|games|game|studios|studio|interactive|publishing|digital|software)\b/g;

export function publisherKey(p?: string | null): string | undefined {
  if (!p) return undefined;
  const k = titleKey(p).replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
  return k || undefined;
}

function publishersMatch(a?: string | null, b?: string | null): boolean {
  const ka = publisherKey(a);
  const kb = publisherKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.startsWith(kb + ' ') || kb.startsWith(ka + ' ');
}

function datesClose(a?: string | null, b?: string | null, days = 120): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= days * 86400_000;
}

/**
 * Decide whether an entry from one regional catalog is the same product as
 * a game we already know from another. Same title alone is not enough:
 * we also need the product code, the publisher, or a close release date to
 * agree. Two equally good candidates means we can't tell, so no match.
 */
export function pickMatch(incoming: MatchInput, candidates: GameRow[]): { game: GameRow; method: MatchMethod } | undefined {
  const key = titleKey(incoming.title);
  const inCore = productCore(incoming.productCode);
  const scored: { game: GameRow; method: MatchMethod }[] = [];

  for (const c of candidates) {
    if (c.title_key !== key) continue;
    const cCore = productCore(c.product_code ?? undefined);
    if (inCore && cCore) {
      if (inCore === cCore) scored.push({ game: c, method: 'product_code' });
      continue; // codes disagree: different products
    }
    if (publishersMatch(incoming.publisher, c.publisher)) scored.push({ game: c, method: 'title_publisher' });
    else if (datesClose(incoming.releaseDate, c.release_date)) scored.push({ game: c, method: 'title_date' });
  }

  if (!scored.length) return undefined;
  scored.sort((a, b) => RANK[b.method] - RANK[a.method]);
  if (scored.length > 1 && RANK[scored[0].method] === RANK[scored[1].method]) return undefined;
  return scored[0];
}
