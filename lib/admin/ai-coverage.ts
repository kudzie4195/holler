import { PAGE_SIZE, type Db } from '@/lib/signals/store';

/**
 * AI coverage line for the owner's quality page (PLAN-2.0 item 2.5): of the permit and civic records that arrived in the last 24
 * hours, how many have a result from the AI step (holler_signal_ai, origin model or cache), and how many of those carry a
 * "why it matters" line. Read only (selects). Internal: counts only, no record text.
 *
 * "New" means the row was inserted (holler_signals.created_at) in the window. The AI step reads records by their own date
 * (occurred_at, last 14 days), so a record dated further back than that is never classified: it counts as not classified here and
 * is also reported as outsideWindow, so the gap is visible and not hidden in the percentage.
 * A table that cannot be read gives status 'unavailable' (blank, never 0%).
 */

export const AI_COVERAGE_HOURS = 24;
export const AI_LOOKBACK_DAYS = 14;
const KINDS = ['permit', 'civic'] as const;
const MAX_PAGES = 20;
const CHUNK = 200;

export interface AiCoverage {
  status: 'ok' | 'partial' | 'unavailable';
  windowHours: number;
  total: number;
  classified: number;
  /** classified / total as a fraction 0..1, or null when there are no new rows (or the read failed). */
  classifiedShare: number | null;
  withNote: number;
  withNoteShare: number | null;
  /** New rows dated before the AI step's 14 day window: they can never be classified. */
  outsideWindow: number;
  byKind: Record<(typeof KINDS)[number], { total: number; classified: number }>;
}

const share = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

export function emptyCoverage(status: AiCoverage['status']): AiCoverage {
  return {
    status,
    windowHours: AI_COVERAGE_HOURS,
    total: 0,
    classified: 0,
    classifiedShare: null,
    withNote: 0,
    withNoteShare: null,
    outsideWindow: 0,
    byKind: { permit: { total: 0, classified: 0 }, civic: { total: 0, classified: 0 } },
  };
}

export async function loadAiCoverage(db: Db, now: Date): Promise<AiCoverage> {
  const since = new Date(now.getTime() - AI_COVERAGE_HOURS * 3_600_000).toISOString();
  const windowStart = now.getTime() - AI_LOOKBACK_DAYS * 86_400_000;
  const rows: { id: number; kind: string; occurred_at: string | null }[] = [];
  let partial = false;
  try {
    let offset = 0;
    for (let page = 0; page <= MAX_PAGES; page++) {
      const { data, error } = await db
        .from('holler_signals')
        .select('id,kind,occurred_at')
        .in('kind', [...KINDS])
        .gte('created_at', since)
        .order('id', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return emptyCoverage('unavailable');
      const got = (data ?? []) as typeof rows;
      if (got.length === 0) break;
      if (page === MAX_PAGES) {
        partial = true;
        break;
      }
      rows.push(...got);
      offset += got.length;
    }
  } catch {
    return emptyCoverage('unavailable');
  }

  const done = new Map<number, boolean>(); // signal id -> has a note
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
      const { data, error } = await db.from('holler_signal_ai').select('signal_id,origin,notes').in('signal_id', ids);
      if (error) return emptyCoverage('unavailable');
      for (const a of (data ?? []) as { signal_id: number; origin: string | null; notes: unknown }[]) {
        if (a.origin === 'skip') continue;
        const hasNote = !!a.notes && typeof a.notes === 'object' && Object.keys(a.notes as object).length > 0;
        done.set(Number(a.signal_id), hasNote);
      }
    }
  } catch {
    return emptyCoverage('unavailable');
  }

  const out = emptyCoverage(partial ? 'partial' : 'ok');
  for (const r of rows) {
    const k = r.kind as (typeof KINDS)[number];
    if (!out.byKind[k]) continue;
    out.total++;
    out.byKind[k].total++;
    const t = r.occurred_at ? Date.parse(r.occurred_at) : NaN;
    if (Number.isFinite(t) && t < windowStart) out.outsideWindow++;
    if (done.has(r.id)) {
      out.classified++;
      out.byKind[k].classified++;
      if (done.get(r.id)) out.withNote++;
    }
  }
  out.classifiedShare = share(out.classified, out.total);
  out.withNoteShare = share(out.withNote, out.total);
  return out;
}

/** One plain line for the HTML page and the logs. */
export function aiCoverageLine(c: AiCoverage): string {
  if (c.status === 'unavailable') return 'AI coverage: unavailable (read failed, not zero).';
  if (c.total === 0) return `AI coverage: no new permit or civic rows in the last ${c.windowHours} hours.`;
  const p = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);
  return (
    `AI coverage, last ${c.windowHours} hours: ${c.classified} of ${c.total} new permit and civic rows classified (${p(c.classifiedShare)}), ` +
    `${c.withNote} with a why-it-matters line (${p(c.withNoteShare)}).` +
    (c.outsideWindow > 0 ? ` ${c.outsideWindow} are dated before the 14 day window and cannot be classified.` : '') +
    (c.status === 'partial' ? ' Partial: row limit reached, newest rows only.' : '')
  );
}
