import type { OpportunityDto } from '@/lib/signals/member-opportunity';
export interface CheckItem {
  id: number;
  kind: string;
  source: string;
  title: string;
  url: string | null;
  place: string | null;
  /** Coordinates of the record, null for state-level records. Kept for callers; the distance test already ran in SQL. */
  lat?: number | null;
  lon?: number | null;
  occurredAt: string;
  severity: number;
  /** The record's opportunity for the chosen trade (lib/check/load.ts). Context rows are never listed. */
  opportunity?: OpportunityDto | null;
}

/** Counts per label (Act now, Coming soon, Market insight) of the items that will be shown. Pure. */
export function opportunityCounts(items: readonly Pick<CheckItem, 'opportunity'>[]): Record<'act' | 'soon' | 'intel', number> {
  const out = { act: 0, soon: 0, intel: 0 };
  for (const it of items) {
    const l = it.opportunity?.label;
    if (l === 'act' || l === 'soon' || l === 'intel') out[l]++;
  }
  return out;
}

export interface CheckGroup {
  id: string;
  title: string;
  items: CheckItem[];
}

import { haversineMi } from '@/lib/geo';
import { isUpcoming, toMs } from '@/lib/time';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';

export const MAX_ITEMS = 20;
export const MAX_PER_GROUP = 8;
/** Records this close to the ZIP (miles) count as "local" for ordering. It is the radius a new subscriber gets by default. */
export const LOCAL_MI = 25;

const GROUPS: { id: string; title: string; kinds: string[] }[] = [
  { id: 'weather', title: 'Weather and disasters', kinds: ['alert', 'report', 'disaster', 'quake'] },
  { id: 'ask', title: 'Requests for local help', kinds: ['ask'] },
  { id: 'permit', title: 'Building permits', kinds: ['permit'] },
  { id: 'civic', title: '311, inspections and city records', kinds: ['civic'] },
  { id: 'contract', title: 'Federal contracts', kinds: ['contract'] },
  { id: 'event', title: 'Events', kinds: ['event'] },
  { id: 'travel', title: 'Airport delays', kinds: ['travel'] },
];

function groupIdFor(kind: string): string {
  return GROUPS.find((g) => g.kinds.includes(kind))?.id ?? 'other';
}

/** Distance in miles from the ZIP to a record, or null when the record has no coordinates (state-level alerts) or no origin was given. */
export function distanceFrom(origin: { lat: number; lon: number } | undefined, it: CheckItem): number | null {
  if (!origin || typeof it.lat !== 'number' || typeof it.lon !== 'number') return null;
  if (hasApproxLocation(it)) return null;
  const d = haversineMi(origin.lat, origin.lon, it.lat, it.lon);
  return Number.isFinite(d) ? d : null;
}

/**
 * The place line of a record: its "City, ST", or for a record whose position is a stand-in (Cobb County) the plain note
 * "In Cobb County. The county's feed has a street address but no map point, so no distance is shown." (approx-location.ts).
 */
export function placeLine(it: Pick<CheckItem, 'source' | 'place'>): string | null {
  if (hasApproxLocation(it)) return approxLocationNote({ city: (it.place ?? '').split(',')[0]?.trim() || null });
  return it.place;
}

/**
 * What the page puts first, in this order:
 *  0. active severe weather and disaster records (severity 2 or more), most severe then newest;
 *  1. upcoming records (events), soonest start first;
 *  2. records within LOCAL_MI of the ZIP, closest first (only when the ZIP's position is known);
 *  3. everything else, newest first.
 * Both what is kept under the caps and the order inside each group follow this order.
 */
function compareItems(a: CheckItem, b: CheckItem, now: number, origin?: { lat: number; lon: number }): number {
  const rank = (it: CheckItem): number => {
    if (it.severity >= 2 && groupIdFor(it.kind) === 'weather') return 0;
    if (isUpcoming(it.occurredAt, now)) return 1;
    const d = distanceFrom(origin, it);
    return d !== null && d <= LOCAL_MI ? 2 : 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  const newest = toMs(b.occurredAt) - toMs(a.occurredAt);
  if (ra === 0) return b.severity - a.severity || newest;
  if (ra === 1) return toMs(a.occurredAt) - toMs(b.occurredAt);
  if (ra === 2) return (distanceFrom(origin, a) ?? 0) - (distanceFrom(origin, b) ?? 0) || newest;
  return newest;
}

/**
 * Orders the records as compareItems says, keeps at most MAX_PER_GROUP per group and MAX_ITEMS overall (so one busy feed such as
 * permits cannot crowd out weather alerts), and groups them. Groups with an active severe alert come first, then groups are ordered by
 * their newest item that is not in the future, so a far-off event never pins its group to the top; a group with only upcoming items goes
 * after the groups that have recent items. `origin` is the ZIP's own position; without it nothing counts as local.
 */
export function groupItems(items: CheckItem[], now: number = Date.now(), origin?: { lat: number; lon: number }): CheckGroup[] {
  // A record that is only 'context' for the trade is never listed as an alert (lib/check/load.ts already leaves them out).
  const sorted = items.filter((i) => i.opportunity?.label !== 'context').sort((a, b) => compareItems(a, b, now, origin));
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
  const hasSevere = (id: string, list: CheckItem[]) => id === 'weather' && list.some((i) => i.severity >= 2);
  return [...buckets.entries()]
    .map(([id, list]) => ({ id, title: titleOf(id), items: list, key: newestPastMs(list), severe: hasSevere(id, list) ? 1 : 0 }))
    .sort((a, b) => b.severe - a.severe || b.key - a.key)
    .map(({ id, title, items: list }) => ({ id, title, items: list }));
}

/** Only plain web links are shown as links. */
export function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
