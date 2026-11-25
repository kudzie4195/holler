import { BID_SOURCE_PREFIX, ERATE_SOURCE_ID, bidsEnabled, erateEnabled } from '@/lib/signals/bid-sources';
import { WINDOW_DAYS } from './threshold';
import { UPCOMING_DAYS } from '../time';

/**
 * The holler_place_counts view (migrations 0001 and 0003) counts every stored signal, city bids included, so while HOLLER_BIDS_ENABLED
 * is off a stored bid row would still raise a city's count (and its sitemap entry). The view is a database object and is not changed
 * here (review P2-1): the code reads the stored bid rows per place and subtracts them. A later migration can add
 * `where source not like 'bids-%'` to the view and this subtraction becomes a no-op.
 * Best effort: a failed read returns {} and the counts stay as the view gave them.
 */
export async function bidCountsByPlace(
  sb: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  nowMs: number = Date.now(),
  on: boolean = bidsEnabled(),
  erateOn: boolean = erateEnabled(),
): Promise<Record<string, number>> {
  // Bids on and E-Rate on: nothing is hidden. Bids on and E-Rate off: only the E-Rate rows are subtracted. Bids off: every bid row.
  if (on && erateOn) return {};
  try {
    // The view's own window: occurred_at after now - 60 days and up to 14 days ahead.
    const since = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
    const until = new Date(nowMs + UPCOMING_DAYS * 86_400_000).toISOString();
    const q = sb.from('holler_signals').select('place_slug');
    if (typeof q?.like !== 'function' || (on && typeof q?.eq !== 'function')) return {};
    const r = await (on ? q.eq('source', ERATE_SOURCE_ID) : q.like('source', `${BID_SOURCE_PREFIX}%`)).gt('occurred_at', since).lte('occurred_at', until).limit(1000);
    if (!r || r.error) return {};
    const out: Record<string, number> = {};
    for (const row of (r.data ?? []) as { place_slug?: string | null }[]) {
      if (row.place_slug) out[row.place_slug] = (out[row.place_slug] ?? 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}

/** Counts minus the stored bid rows of each place, never below zero. */
export function minusBids(counts: Record<string, number>, bids: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...counts };
  for (const [slug, n] of Object.entries(bids)) if (slug in out) out[slug] = Math.max(0, out[slug] - n);
  return out;
}
