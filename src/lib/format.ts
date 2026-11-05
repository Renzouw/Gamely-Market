/** "just now", "4 min ago", "2 h ago", "3 days ago" */
export function ago(t: number | undefined, now = Date.now()): string | undefined {
  if (!t) return undefined;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function initials(title: string): string {
  const words = title.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(the|of|a|an|and)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join('') || title.slice(0, 2)).toUpperCase();
}

export function shortDate(t: number | string | undefined): string | undefined {
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return typeof t === 'string' ? t : undefined;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
