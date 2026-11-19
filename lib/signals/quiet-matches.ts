import type { SupabaseClient } from '@supabase/supabase-js';

type Db = Pick<SupabaseClient, 'from'>;

/**
 * Matches that are history, not news (commander decision 2, verify-v1 finding 1): signup and re-target backfill rows, re-map gains,
 * rematches of records older than 3 days, anything inserted with notified = true. They are shown in the feed but must never be counted
 * by a push, so they are inserted with `pushed_at` already set to the insert time (lib/push/notify.ts reads only pushed_at is null).
 * Before migration 0020 there is no pushed_at column: the insert is retried once without it (push does not run without 0020 either).
 */
export interface MatchInsertRow {
  user_id: string;
  signal_id: number;
  distance_mi: number | null;
  notified: boolean;
  /** Set (insert time) on history rows; null on news. */
  pushed_at?: string | null;
}

/** True when a write failed because holler_matches.pushed_at does not exist yet (migration 0020 not applied). */
export function missingPushedAtColumn(message: string | null | undefined): boolean {
  const m = message ?? '';
  return /pushed_at/i.test(m) && /column|schema cache|does not exist|PGRST204|42703/i.test(m);
}

/** A history row: notified and already counted as pushed at `now`. */
export function historyRow(r: Omit<MatchInsertRow, 'notified' | 'pushed_at'>, now: Date): MatchInsertRow {
  return { ...r, notified: true, pushed_at: now.toISOString() };
}

/**
 * Upsert match rows (ignore duplicates on user_id, signal_id). With `count`, returns how many rows were inserted (`.select('id')`).
 * Retries once without pushed_at when the column is missing. Throws on any other error.
 */
export async function upsertMatchRows(db: Db, rows: MatchInsertRow[], opts: { count?: boolean } = {}): Promise<number> {
  if (rows.length === 0) return 0;
  const send = async (part: Record<string, unknown>[]) => {
    const q = db.from('holler_matches').upsert(part, { onConflict: 'user_id,signal_id', ignoreDuplicates: true });
    if (opts.count) {
      const { data, error } = await q.select('id');
      return { n: (data as unknown[] | null)?.length ?? 0, error };
    }
    const { error } = await q;
    return { n: part.length, error };
  };
  let r = await send(rows as unknown as Record<string, unknown>[]);
  if (r.error && missingPushedAtColumn(r.error.message) && rows.some((x) => 'pushed_at' in x)) {
    r = await send(rows.map(({ pushed_at: _p, ...rest }) => (void _p, rest)));
  }
  if (r.error) throw new Error(r.error.message);
  return r.n;
}
