import { cacheLife } from 'next/cache';
import { stateBySlug } from '@/lib/geo';
import { publicClient } from '@/lib/seo/client';
import { addDays } from './zones';
import { buildReports, indexWindow, parseSlug, WINDOW_DAYS, type StormReport, type StormRow } from './report';

/**
 * Columns read from holler_signals. There is no title, summary, data.comments, lat, lon or id here on purpose: the SPC remarks
 * field is free text (see report.ts) and is never selected.
 */
const COLUMNS =
  'source,state,county,city,url,occurred_at,created_at,type:data->>type,hail:data->>hailInches,wind:data->>windMph,incident:data->>incidentType,decl:data->>declarationType,disaster:data->>disasterNumber,counties:data->counties';
const PAGE = 1000;
const MAX_PAGES = 10;
const TIMEOUT_MS = 10_000;
const OK_LIFE = { stale: 300, revalidate: 1800, expire: 86400 };
const BAD_LIFE = { stale: 30, revalidate: 60, expire: 300 };

type Filter = { state?: string; from: string; to?: string };

async function fetchRows(f: Filter, maxPages: number): Promise<{ rows: StormRow[]; partial: boolean } | null> {
  const sb = publicClient();
  if (!sb) return null;
  const rows: StormRow[] = [];
  for (let p = 0; p < maxPages; p++) {
    let q = sb.from('holler_signals').select(COLUMNS).in('source', ['spc', 'fema']).gte('occurred_at', f.from);
    if (f.to) q = q.lt('occurred_at', f.to);
    if (f.state) q = q.eq('state', f.state);
    const { data, error } = await q
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const got = (data ?? []) as unknown as StormRow[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, partial: false };
  }
  return { rows, partial: true };
}

export interface StormIndexData {
  ok: boolean;
  asOf: string;
  /** every report in the window, qualifying or not; consumers filter on `qualifies` */
  reports: StormReport[];
  /** true when the row cap was reached, so counts are lower bounds */
  partial: boolean;
}

/** Reports for the last 60 days, read from holler_signals with the anon client. Cached 30 minutes (SPC refreshes every 30). */
export async function loadStormIndex(): Promise<StormIndexData> {
  'use cache';
  const now = Date.now();
  const asOf = new Date(now).toISOString();
  try {
    // Two extra days so a report near midnight in a western zone is not cut off at the window edge.
    const from = new Date(now - (WINDOW_DAYS + 2) * 86_400_000).toISOString();
    const res = await fetchRows({ from }, MAX_PAGES);
    if (!res) {
      cacheLife(BAD_LIFE);
      return { ok: false, asOf, reports: [], partial: false };
    }
    cacheLife(OK_LIFE);
    return { ok: true, asOf, reports: buildReports(res.rows), partial: res.partial };
  } catch (e) {
    console.error('[storms] loadStormIndex failed:', e instanceof Error ? e.message : 'unknown');
    cacheLife(BAD_LIFE);
    return { ok: false, asOf, reports: [], partial: false };
  }
}

export type StormPageData = { status: 'ok'; report: StormReport; asOf: string } | { status: 'missing' } | { status: 'error' };

/**
 * One report by URL parts. Reads only that state and that date (plus the next UTC day, which holds the evening of a local date),
 * so a page keeps working after its date leaves the 60 day list. An unknown state, a slug with no date, or a slug no record matches
 * is 'missing' (the route answers 404).
 */
export async function loadStormReport(stateSlug: string, slug: string): Promise<StormPageData> {
  'use cache';
  const st = stateBySlug(stateSlug);
  const parsed = parseSlug(slug);
  if (!st || !parsed) {
    cacheLife(OK_LIFE);
    return { status: 'missing' };
  }
  try {
    const res = await fetchRows({ state: st.code, from: `${parsed.date}T00:00:00.000Z`, to: `${addDays(parsed.date, 1)}T23:59:59.999Z` }, 3);
    if (!res) {
      cacheLife(BAD_LIFE);
      return { status: 'error' };
    }
    const report = buildReports(res.rows).find((r) => r.slug === slug && r.date === parsed.date) ?? null;
    cacheLife(OK_LIFE);
    return report ? { status: 'ok', report, asOf: new Date().toISOString() } : { status: 'missing' };
  } catch (e) {
    console.error('[storms] loadStormReport failed:', e instanceof Error ? e.message : 'unknown');
    cacheLife(BAD_LIFE);
    return { status: 'error' };
  }
}

/** Qualifying reports in the window, newest first. */
export function qualifyingReports(data: StormIndexData): StormReport[] {
  return data.ok ? indexWindow(data.reports, Date.parse(data.asOf)) : [];
}
