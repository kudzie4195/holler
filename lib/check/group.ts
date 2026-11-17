export interface CheckItem {
  id: number;
  kind: string;
  source: string;
  title: string;
  url: string | null;
  place: string | null;
  occurredAt: string;
  severity: number;
}

export interface CheckGroup {
  id: string;
  title: string;
  items: CheckItem[];
}

import { isUpcoming, orderLatest, toMs } from '@/lib/time';

export const MAX_ITEMS = 20;
export const MAX_PER_GROUP = 8;

const GROUPS: { id: string; title: string; kinds: string[] }[] = [
  { id: 'weather', title: 'Weather and disasters', kinds: ['alert', 'report', 'disaster', 'quake'] },
  { id: 'ask', title: 'People asking for help', kinds: ['ask'] },
  { id: 'permit', title: 'Building permits', kinds: ['permit'] },
  { id: 'civic', title: '311, inspections and city records', kinds: ['civic'] },
  { id: 'contract', title: 'Federal contracts', kinds: ['contract'] },
  { id: 'event', title: 'Events', kinds: ['event'] },
  { id: 'travel', title: 'Airport delays', kinds: ['travel'] },
];

function groupIdFor(kind: string): string {
  return GROUPS.find((g) => g.kinds.includes(kind))?.id ?? 'other';
}

/**
 * Upcoming items first (soonest start first, so an event next week reads in order), then everything else newest first.
 * At most MAX_PER_GROUP per group and MAX_ITEMS overall (so one busy feed such as permits cannot crowd out weather alerts).
 * Groups are ordered by their newest item that is not in the future, so a far-off event never pins its group to the top;
 * a group with only upcoming items goes after the groups that have recent items.
 */
export function groupItems(items: CheckItem[], now: number = Date.now()): CheckGroup[] {
  const sorted = orderLatest(items, (i) => i.occurredAt, now);
  const buckets = new Map<string, CheckItem[]>();
  let total = 0;
  for (const it of sorted) {
    if (total >= MAX_ITEMS) break;
    const id = groupIdFor(it.kind);
    const list = buckets.get(id) ?? [];
    if (list.length >= MAX_PER_GROUP) continue;
    list.push(it);
    buckets.set(id, list);
    total++;
  }
  const titleOf = (id: string) => GROUPS.find((g) => g.id === id)?.title ?? 'Other records';
  const newestPastMs = (list: CheckItem[]) => {
    const past = list.filter((i) => !isUpcoming(i.occurredAt, now)).map((i) => toMs(i.occurredAt));
    return past.length ? Math.max(...past) : -Infinity;
  };
  return [...buckets.entries()]
    .map(([id, list]) => ({ id, title: titleOf(id), items: list, key: newestPastMs(list) }))
    .sort((a, b) => b.key - a.key)
    .map(({ id, title, items: list }) => ({ id, title, items: list }));
}

/** Only plain web links are shown as links. */
export function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
