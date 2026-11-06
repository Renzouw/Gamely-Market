import { config } from '../config';
import { chunk, postJson } from '../sources/http';

/** Expo's push service: one API for both APNs (iOS) and FCM (Android). */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
  /** Collapse repeated alerts for the same game on Android/iOS */
  collapseId?: string;
  priority?: 'default' | 'high';
}

export type PushTicket =
  | { status: 'ok'; id: string }
  /** `transport` means Expo never got the message (network, 5xx): safe to retry */
  | { status: 'error'; message: string; details?: { error?: string }; transport?: boolean };

export type PushReceipt = { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };

function headers(): Record<string, string> {
  return config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {};
}

export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[.+\]$/.test(t);

export async function sendPush(messages: PushMessage[]): Promise<PushTicket[]> {
  const tickets: PushTicket[] = [];
  for (const batch of chunk(messages, 100)) {
    try {
      const res = await postJson<{ data?: PushTicket[]; errors?: { message: string }[] }>(`${config.upstream.expoPush}/send`, batch, headers());
      const data = res.data ?? [];
      batch.forEach((_, i) => tickets.push(data[i] ?? { status: 'error', message: res.errors?.[0]?.message ?? 'No ticket returned' }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      batch.forEach(() => tickets.push({ status: 'error', message, transport: true }));
    }
  }
  return tickets;
}

export async function getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
  const out: Record<string, PushReceipt> = {};
  for (const batch of chunk(ids, 300)) {
    const res = await postJson<{ data?: Record<string, PushReceipt> }>(`${config.upstream.expoPush}/getReceipts`, { ids: batch }, headers());
    Object.assign(out, res.data ?? {});
  }
  return out;
}
