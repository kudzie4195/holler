import type { Db } from './store';
import { readAllPages } from './store';
import { missingTable } from './projects';

/**
 * Duplicate rate per source (PLAN-2.0 item 2.3). READ ONLY.
 *
 * holler_dedupe_drops (migration 0025) holds one row per record that was not stored as a duplicate ("duplicate") or that was stored only
 * as evidence for a project another source already has ("corroboration"), one row per record however many scans re-read it. This
 * counts them per source for the last DUPLICATE_WINDOW_DAYS days and sets them against the rows stored from that source in the same window:
 *   rate = duplicates / (stored + duplicates)      (corroborations are stored rows, so they are in `stored` and not in the rate)
 * A read that fails, or a table that is missing (migration 0025 not applied), is reported as unavailable: blank, never zero.
 */
export const DUPLICATE_WINDOW_DAYS = 7;

export interface DuplicateSourceRow {
  source: string;
  /** Records not stored because they were the same project as another record of the same source (or a mirror). */
  duplicates: number;
  /** Records stored as another source's evidence about a project that already had a card. */
  corroborations: number;
  /** Rows stored from this source in the window. */
  stored: number;
  /** duplicates / (stored + duplicates), or null when both are 0. */
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
export function duplicateRates(drops: ReadonlyArray<{ source: string; kind: string }>, storedBySource: Readonly<Record<string, number>>): DuplicateSourceRow[] {
  const by = new Map<string, { duplicates: number; corroborations: number }>();
  for (const d of drops) {
    const e = by.get(d.source) ?? { duplicates: 0, corroborations: 0 };
    if (d.kind === 'duplicate') e.duplicates++;
    else if (d.kind === 'corroboration') e.corroborations++;
    by.set(d.source, e);
  }
  return [...by.entries()]
    .map(([source, e]) => {
      const stored = storedBySource[source] ?? 0;
      const denom = stored + e.duplicates;
      return { source, duplicates: e.duplicates, corroborations: e.corroborations, stored, rate: denom > 0 ? e.duplicates / denom : null };
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
  const stored: Record<string, number> = {};
  for (const source of sources) {
    try {
      const { count, error } = await db.from('holler_signals').select('id', { count: 'exact', head: true }).eq('source', source).gte('created_at', since);
      if (!error && typeof count === 'number') stored[source] = count;
    } catch {
      /* a missing count leaves stored at 0 for that source: the rate then reads as 100% of what is known, so flag it */
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
