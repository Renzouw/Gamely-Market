export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

/**
 * Each store host gets its own small queue so a slow or rate-limited store
 * never holds up the others, and we never hammer any one of them.
 */
const PER_HOST = Number(process.env.HTTP_PER_HOST ?? 3);
const queues = new Map<string, { active: number; waiting: (() => void)[] }>();

async function slot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  let q = queues.get(host);
  if (!q) queues.set(host, (q = { active: 0, waiting: [] }));
  if (q.active >= PER_HOST) await new Promise<void>((r) => q!.waiting.push(r));
  q.active++;
  try {
    return await fn();
  } finally {
    q.active--;
    q.waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOpts {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

const UA = 'GamelyPriceTracker/1.0';

export async function request(url: string, opts: RequestOpts = {}): Promise<Response> {
  const { retries = 2, timeoutMs = 20_000, headers, ...init } = opts;
  const host = new URL(url).host;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await slot(host, () =>
        fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) }),
      );
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        lastError = new HttpError(res.status, url);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      lastError = e;
      if (e instanceof HttpError) throw e;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request to ${host} failed`);
}

export async function getJson<T>(url: string, opts?: RequestOpts): Promise<T> {
  return (await (await request(url, opts)).json()) as T;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

export async function getText(url: string, opts?: RequestOpts): Promise<string> {
  return (await request(url, { ...opts, headers: { Accept: 'text/html', ...opts?.headers } })).text();
}

/** Query string. An array repeats the key, e.g. { "f[]": ["a", "b"] } → "f%5B%5D=a&f%5B%5D=b". */
export function qs(params: Record<string, string | number | boolean | string[] | undefined>): string {
  return Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x] as const) : [[k, v] as const]))
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
