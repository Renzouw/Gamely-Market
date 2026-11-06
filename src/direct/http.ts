/**
 * Network access for phone-only mode. Each store gets a small queue so the
 * app never fires dozens of requests at once from your phone.
 */
const PER_HOST = 4;
const queues = new Map<string, { active: number; waiting: (() => void)[] }>();

async function slot<T>(host: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let q = queues.get(host);
  if (!q) queues.set(host, (q = { active: 0, waiting: [] }));
  const waited = q.active >= PER_HOST;
  if (waited) await new Promise<void>((r) => q!.waiting.push(r));
  if (signal?.aborted) {
    // The screen that asked moved on: hand the slot this was given straight to the next one
    if (waited) q.waiting.shift()?.();
    throw new StoreError('Cancelled');
  }
  q.active++;
  try {
    return await fn();
  } finally {
    q.active--;
    q.waiting.shift()?.();
  }
}

/** Names people recognise, for error messages */
function storeName(host: string): string {
  if (host.includes('nintendo')) return 'the Nintendo eShop';
  if (host.includes('steam')) return 'Steam';
  if (host.includes('frankfurter') || host.includes('er-api')) return 'the exchange rate service';
  return host;
}

export class StoreError extends Error {
  name = 'StoreError';
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** `signal` cancels the request (or its place in the queue) when the screen that asked no longer needs it. */
export async function getJson<T>(url: string, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  const host = url.split('/')[2] ?? url;
  return slot(host, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const cancel = () => ctrl.abort();
    signal?.addEventListener('abort', cancel);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new StoreError(`${storeName(host)} is having trouble right now (error ${res.status}). Try again in a moment.`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(`Can’t reach ${storeName(host)}. Check your connection.`);
    } finally {
      clearTimeout(t);
      signal?.removeEventListener('abort', cancel);
    }
  }, signal);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
