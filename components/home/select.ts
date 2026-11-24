import { HOME_TZ, type Family, type HomeMap, type MapRecord } from '@/lib/seo/home-map';
import type { LedgerExample } from '@/lib/seo/home-live';

/** Pure choices of which picked record each section shows. All read from the one picked set, so the sections agree. */

const time = (r: MapRecord) => (r.occurredAt ? Date.parse(r.occurredAt) : 0);

/** Newest record on a live map (the "latest" band). Null for the example. */
export function newestRecord(map: HomeMap): MapRecord | null {
  if (!map.live || !map.records.length) return null;
  return [...map.records].sort((a, b) => time(b) - time(a))[0];
}

/**
 * Round 24 FIX2 (review P3-8): the home page shows a permit a marketed trade would get: a new-home, new-construction or re-roof permit
 * (landscaping, lawn care, cleaning and siding and gutters get those as downstream alerts), never an electrical or HVAC permit.
 */
export const MARKETED_PERMIT_RE = /^(?:New (?:home|construction|build)|Re-?roof|Roof)\b[^.]*\bpermit\b/i;
const marketedPermit = (r: MapRecord) => r.family === 'permit' && MARKETED_PERMIT_RE.test(r.title);

/** The record on the alert card and the phone's push banner: the newest marketed permit, else the newest permit, else the newest record. */
export function featuredRecord(map: HomeMap): MapRecord {
  const marketed = map.records.filter(marketedPermit);
  const permits = marketed.length ? marketed : map.records.filter((r) => r.family === 'permit');
  const pool = permits.length ? permits : map.records;
  // Round 24 (review P2-9): the example leads with a launch trade (lib/seo/home-map.ts EXAMPLE_RECORDS).
  if (!map.live) return pool.find((r) => /^Gutter permit/.test(r.title)) ?? pool[0];
  return [...pool].sort((a, b) => time(b) - time(a))[0];
}

/** The three cards in the phone feed: the newest other records (the example keeps the design's order). */
export function phoneRecords(map: HomeMap, featured: MapRecord): MapRecord[] {
  const rest = map.records.filter((r) => r.id !== featured.id);
  if (!map.live) return [rest.find((r) => /^Landscaping/.test(r.title)), rest.find((r) => /^Fence/.test(r.title)), rest.find((r) => r.family === 'civic')].filter((r): r is MapRecord => !!r);
  return [...rest].sort((a, b) => time(b) - time(a)).slice(0, 3);
}

/** The ledger's example line per family: a real recent record, or nothing. */
export function ledgerExamples(map: HomeMap, weather: LedgerExample | null): Record<Family, LedgerExample | null> {
  const fromMap = (f: Family): LedgerExample | null => {
    if (!map.live) return null;
    // The permit line shows a permit a marketed trade gets (P3-8), or no example at all.
    const r = [...map.records].filter((x) => (f === 'permit' ? marketedPermit(x) : x.family === f)).sort((a, b) => time(b) - time(a))[0];
    return r && r.occurredAt ? { title: r.title, occurredAt: r.occurredAt, mi: r.mi, tz: HOME_TZ } : null;
  };
  const tidy = (e: LedgerExample | null): LedgerExample | null => (e ? { ...e, title: tidyInches(e.title) } : null);
  return { permit: tidy(fromMap('permit')), civic: tidy(fromMap('civic')), weather: tidy(fromMap('weather') ?? weather) };
}

/** "1.00 inch hail" reads as raw data: drop trailing zeros from a size in inches ("1 inch", "1.5 inch", "1.75 inch"). */
export function tidyInches(title: string): string {
  return title.replace(/\b(\d+\.\d+)(?= inch)/g, (n) => String(Number(n)));
}

/**
 * Tag and short note for a record on light surfaces. A code violation is a code case; it is called a repair order only when its
 * own title says repair (not every violation orders one).
 */
export function recordTag(r: Pick<MapRecord, 'family' | 'title'>): { tag: string; note: string } {
  if (r.family === 'permit') return { tag: 'PERMIT', note: 'Money being spent' };
  if (r.family === 'weather') return { tag: 'WEATHER', note: 'Storm nearby' };
  if (/^311\b/.test(r.title)) return { tag: '311', note: 'A city request' };
  return { tag: 'CODE CASE', note: /\brepair/i.test(r.title) ? 'A repair ordered' : 'A city code case' };
}
