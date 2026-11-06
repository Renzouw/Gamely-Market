import { all, placeholders, run, type Db } from '../db';
import { tx } from '../store';
import { getReceipts, isExpoToken, sendPush, type PushMessage } from './expo';

interface Due {
  id: number;
  device_id: string;
  game_id: string | null;
  kind: string;
  title: string;
  body: string;
  data: string;
  expires_at: number | null;
  push_token: string | null;
  alerts_enabled: number;
  attempts: number;
}

/** Retries for messages Expo never received, with growing gaps: 1, 2, 4, 8, 16 minutes. */
export const MAX_ATTEMPTS = 6;

/** Four or more alerts for one person at once become a single summary. */
export const DIGEST_AT = 4;

export function buildMessages(due: Due[]): { message: PushMessage; ids: number[] }[] {
  const byDevice = new Map<string, Due[]>();
  for (const n of due) byDevice.set(n.device_id, [...(byDevice.get(n.device_id) ?? []), n]);
  const out: { message: PushMessage; ids: number[] }[] = [];
  for (const list of byDevice.values()) {
    const to = list[0].push_token!;
    if (list.length >= DIGEST_AT) {
      const names = list.slice(0, 3).map((n) => n.title.replace(/ (is on sale|hit your price|dropped to .*)$/, '').replace(/^Last chance: /, '').replace(/: lowest price yet$/, '').replace(/ is \d+% off$/, ''));
      out.push({
        message: {
          to,
          title: `${list.length} price alerts from your watchlist`,
          body: `${names.join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}.`,
          data: { screen: 'activity' },
          sound: 'default',
          channelId: 'price-alerts',
        },
        ids: list.map((n) => n.id),
      });
    } else {
      for (const n of list) {
        out.push({
          message: {
            to,
            title: n.title,
            body: n.body,
            data: JSON.parse(n.data),
            sound: 'default',
            channelId: 'price-alerts',
            collapseId: n.game_id ?? undefined,
            priority: n.kind === 'ending' || n.kind === 'target' ? 'high' : 'default',
          },
          ids: [n.id],
        });
      }
    }
  }
  return out;
}

export async function dispatch(db: Db, now = Date.now()): Promise<{ sent: number; skipped: number; failed: number; retried?: number }> {
  const due = all<Due>(
    db,
    `SELECT n.id, n.device_id, n.game_id, n.kind, n.title, n.body, n.data, n.expires_at, n.attempts, d.push_token, d.alerts_enabled
     FROM notifications n JOIN devices d ON d.id = n.device_id
     WHERE n.status = 'pending' AND n.send_after <= ? ORDER BY n.created_at LIMIT 1000`,
    now,
  );
  let skipped = 0;
  const deliverable: Due[] = [];
  for (const n of due) {
    // Every alert stays in the in-app feed; push is only for phones that turned it on.
    const reason =
      n.expires_at !== null && n.expires_at <= now ? 'expired' : !n.alerts_enabled ? 'push off' : !n.push_token || !isExpoToken(n.push_token) ? 'no push token' : undefined;
    if (reason) {
      run(db, "UPDATE notifications SET status = 'skipped', error = ? WHERE id = ?", reason, n.id);
      skipped++;
    } else deliverable.push(n);
  }
  if (!deliverable.length) return { sent: 0, skipped, failed: 0, retried: 0 };

  const attemptsById = new Map(deliverable.map((n) => [n.id, n.attempts ?? 0]));
  let retried = 0;
  const batches = buildMessages(deliverable);
  const tickets = await sendPush(batches.map((b) => b.message));
  let sent = 0;
  let failed = 0;
  tx(db, () => {
    batches.forEach((b, i) => {
      const t = tickets[i];
      for (const id of b.ids) {
        if (t.status === 'ok') {
          run(db, "UPDATE notifications SET status = 'sent', ticket_id = ? WHERE id = ?", t.id, id);
          sent++;
        } else if (t.transport && (attemptsById.get(id) ?? 0) + 1 < MAX_ATTEMPTS) {
          // Expo never got it: try again later instead of dropping the alert
          const attempts = (attemptsById.get(id) ?? 0) + 1;
          run(db, 'UPDATE notifications SET attempts = ?, send_after = ?, error = ? WHERE id = ?', attempts, now + 60_000 * 2 ** (attempts - 1), t.message, id);
          retried++;
        } else {
          run(db, "UPDATE notifications SET status = 'failed', error = ? WHERE id = ?", t.message, id);
          failed++;
        }
      }
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
        run(db, 'UPDATE devices SET push_token = NULL WHERE push_token = ?', b.message.to);
      }
    });
  });
  return { sent, skipped, failed, retried };
}

/** Expo hands out tickets first and delivery receipts later. Check them and drop dead tokens. */
export async function checkReceipts(db: Db, now = Date.now()) {
  const rows = all<{ ticket_id: string }>(
    db,
    "SELECT DISTINCT ticket_id FROM notifications WHERE status = 'sent' AND ticket_id IS NOT NULL AND created_at > ?",
    now - 24 * 3600_000,
  );
  if (!rows.length) return;
  const receipts = await getReceipts(rows.map((r) => r.ticket_id));
  tx(db, () => {
    for (const [ticket, r] of Object.entries(receipts)) {
      if (r.status === 'ok') run(db, "UPDATE notifications SET status = 'delivered' WHERE ticket_id = ?", ticket);
      else {
        run(db, "UPDATE notifications SET status = 'failed', error = ? WHERE ticket_id = ?", r.message, ticket);
        if (r.details?.error === 'DeviceNotRegistered') {
          const ids = all<{ device_id: string }>(db, 'SELECT device_id FROM notifications WHERE ticket_id = ?', ticket).map((x) => x.device_id);
          if (ids.length) run(db, `UPDATE devices SET push_token = NULL WHERE id IN (${placeholders(ids.length)})`, ...ids);
        }
      }
    }
  });
}
