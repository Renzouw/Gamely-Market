export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`Request failed (${status}) for ${new URL(url).host}`);
  }
}

const MAX_PARALLEL = 6;
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

async function request(url: string, opts: RequestOpts = {}): Promise<Response> {
  const { retries = 1, timeoutMs = 15000, ...init } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await slot(() => fetch(url, { ...init, signal: controller.signal }));
      // Retry rate limits and server hiccups, not client errors.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastError = new HttpError(res.status, url);
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      lastError = e;
      if (e instanceof HttpError) throw e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

export async function getJson<T>(url: string, opts?: RequestOpts): Promise<T> {
  const res = await request(url, opts);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A sentence a person can act on, instead of "Failed to fetch". */
export function friendlyError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 429) return 'The store is rate limiting us. Wait a minute and try again.';
    if (e.status >= 500) return 'The store is having trouble right now. Try again shortly.';
    return e.message;
  }
  if (e instanceof Error && e.name === 'AbortError') return 'The store took too long to answer.';
  return 'Check your internet connection and try again.';
}
