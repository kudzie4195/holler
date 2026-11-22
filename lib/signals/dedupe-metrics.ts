import type { Db } from './store';
import { readAllPages } from './store';
import { missingTable } from './projects';

/**
 * Duplicate rate per source (PLAN-2.0 item 2.3). READ ONLY.
 *
 * holler_dedupe_drops (migration 0025) holds one row per record STORED as a follower of an earlier record of the same project: "duplicate"
 * (the same source or a mirror lists the project again) or "corroboration" (another source does). Nothing is dropped: the follower is
 * stored, with its own contacts and stages, and makes no card of its own. One row per record however many scans re-read it. This counts
 * them per source for the last DUPLICATE_WINDOW_DAYS days and sets them against the rows stored from that source in the same window:
 *   rate = duplicates / stored      (corroborations are not in the rate: another source's evidence is not a duplicate)
 * A read that fails, or a table that is missing (migration 0025 not applied), is reported as unavailable: blank, never zero. A source whose
 * stored count could not be read has stored and rate null (blank), never 0 or 100%.
 */
export const DUPLICATE_WINDOW_DAYS = 7;

export interface DuplicateSourceRow {
  source: string;
  /** Records stored as another listing of a project the same source (or a mirror) already had: no second card. */
  duplicates: number;
  /** Records stored as another source's evidence about a project that already had a card. */
  corroborations: number;
  /** Rows stored from this source in the window, or null when that count could not be read. */
  stored: number | null;
  /** duplicates / stored, or null when stored is null or 0. */
  rate: number | null;
}

export interface DuplicateReport {
  windowDays: number;
  since: string;
  status: 'ok' | 'unavailable';
  /** Why the report is unavailable, in plain words. Null when ok. */
  reason: string | null;
  bySource: DuplicateSourceRow[];
  totals: { duplicates: number; corroborations: number };
}

/** Pure: drop rows and per-source stored counts in, per-source rows out (most duplicates first). */
export function duplicateRates(drops: ReadonlyArray<{ source: string; kind: string }>, storedBySource: Readonly<Record<string, number | null>>): DuplicateSourceRow[] {
  const by = new Map<string, { duplicates: number; corroborations: number }>();
  for (const d of drops) {
    const e = by.get(d.source) ?? { duplicates: 0, corroborations: 0 };
    if (d.kind === 'duplicate') e.duplicates++;
    else if (d.kind === 'corroboration') e.corroborations++;
    by.set(d.source, e);
  }
  return [...by.entries()]
    .map(([source, e]) => {
      const stored = storedBySource[source] ?? null;
      return { source, duplicates: e.duplicates, corroborations: e.corroborations, stored, rate: stored !== null && stored > 0 ? e.duplicates / stored : null };
    })
    .sort((a, b) => b.duplicates - a.duplicates || b.corroborations - a.corroborations || a.source.localeCompare(b.source));
}

const unavailable = (since: string, reason: string): DuplicateReport => ({ windowDays: DUPLICATE_WINDOW_DAYS, since, status: 'unavailable', reason, bySource: [], totals: { duplicates: 0, corroborations: 0 } });

/** Reads the drop log and the stored counts of the sources that appear in it. Never throws. */
export async function loadDuplicateRates(db: Db, now: Date): Promise<DuplicateReport> {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
  let drops: Array<{ source: string; kind: string }>;
  try {
    drops = await readAllPages<{ source: string; kind: string }>(
      (from, to) =>
        db
          .from('holler_dedupe_drops')
          .select('source, kind')
          .gte('dropped_at', since)
          .order('dropped_at', { ascending: false })
          .order('external_id', { ascending: false })
          .range(from, to),
      30,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return unavailable(since, missingTable({ message: msg }, 'holler_dedupe_drops') ? 'migration 0025 is not applied' : 'the duplicate log could not be read');
  }
  const sources = [...new Set(drops.map((d) => d.source))];
  const stored: Record<string, number | null> = {};
  for (const source of sources) {
    stored[source] = null;
    try {
      const { count, error } = await db.from('holler_signals').select('id', { count: 'exact', head: true }).eq('source', source).gte('created_at', since);
      if (!error && typeof count === 'number') stored[source] = count;
    } catch {
      /* the count stays null: the dashboard shows blank, never a rate against zero rows */
    }
  }
  const bySource = duplicateRates(drops, stored);
  return {
    windowDays: DUPLICATE_WINDOW_DAYS,
    since,
    status: 'ok',
    reason: null,
    bySource,
    totals: { duplicates: bySource.reduce((n, r) => n + r.duplicates, 0), corroborations: bySource.reduce((n, r) => n + r.corroborations, 0) },
  };
}
