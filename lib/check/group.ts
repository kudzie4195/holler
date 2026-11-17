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
 * Newest first, at most MAX_PER_GROUP per group and MAX_ITEMS overall (so one busy feed such as permits
 * cannot crowd out weather alerts). Groups are ordered by their newest item.
 */
export function groupItems(items: CheckItem[]): CheckGroup[] {
  const sorted = [...items].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
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
  return [...buckets.entries()].map(([id, list]) => ({ id, title: titleOf(id), items: list }));
}

/** Only plain web links are shown as links. */
export function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
