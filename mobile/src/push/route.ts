// Where tapping a notification takes the member. Pure.
import type { PushData } from '../contract';

export type PushTarget = { name: 'alert'; signalId: number } | { name: 'feed' };

/** Read the data payload of a tapped notification (FCM data values are strings). Unknown shapes open the feed. */
export function pushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<Record<keyof PushData | 'signalId', unknown>>;
  const fromPath = typeof d.path === 'string' ? pathTarget(d.path) : null;
  if (d.type === 'alert') {
    const id = Number(d.signalId);
    if (Number.isSafeInteger(id) && id > 0) return { name: 'alert', signalId: id };
    return fromPath ?? { name: 'feed' };
  }
  if (d.type === 'feed') return { name: 'feed' };
  return fromPath;
}

/** "/alert/123" or "/feed". Anything else is not ours to follow. */
export function pathTarget(path: string): PushTarget | null {
  const m = /^\/alert\/(\d{1,15})\/?$/.exec(path.trim());
  if (m) {
    const id = Number(m[1]);
    return id > 0 ? { name: 'alert', signalId: id } : null;
  }
  if (/^\/feed\/?$/.test(path.trim())) return { name: 'feed' };
  return null;
}
