import { cacheLife } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicClient } from './client';
import { SOCRATA_DATASETS, type SocrataSubtype } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { PROBATION_COLUMN } from '@/lib/signals/probation';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';

/**
 * "From Holler's data" on a guide: one count of the records Holler has stored, dated in the last 30 days, from the sources a guide is
 * about. One bounded query per guide (an exact head count plus the newest SAMPLE_ROWS rows, source and date only), anon client,
 * holler_signals only, cached about an hour. Resident requests (source 'holler-request') are never counted: no spec lists that source,
 * the query also excludes it, and the rows are filtered again here.
 *
 * What the line may say: these are records Holler read and stored. Not demand, not leads, not jobs.
 * When the database is unavailable, the query fails, or the count is zero, there is no fact and the page shows nothing.
 */

const DAY = 86_400_000;
export const WINDOW_DAYS = 30;
export const SAMPLE_ROWS = 1000;
const QUERY_TIMEOUT_MS = 10_000;

export interface GuideDataSpec {
  /** Plural noun phrase for the records, read after a number: "3,803 building permit records". */
  noun: string;
  /** Plural noun for the feeds, when there is more than one: "city and county permit feeds". Omitted for single-source specs. */
  feedNoun?: string;
  /** Exact holler_signals.source values. Never 'holler-request'. */
  sources: string[];
}

function datasetIds(subtype: SocrataSubtype): string[] {
  return [...SOCRATA_DATASETS.filter((d) => d.subtype === subtype), ...ARCGIS_DATASETS.filter((d) => d.subtype === subtype)].map((d) => d.id);
}

/** Guides that get a data line, by slug. The others get none. */
export const GUIDE_DATA_SPECS: Record<string, GuideDataSpec> = {
  'how-contractors-find-work-from-building-permits': {
    noun: 'building permit records',
    feedNoun: 'city and county permit feeds',
    sources: datasetIds('permit'),
  },
  'what-311-requests-tell-local-service-businesses': {
    noun: '311 service requests',
    feedNoun: 'city 311 feeds',
    sources: datasetIds('311'),
  },
  'new-business-licenses-as-a-lead-source': {
    noun: 'new business license records',
    feedNoun: 'city license feeds',
    sources: datasetIds('business'),
  },
  'storm-damage-leads-from-weather-alerts-and-storm-reports': {
    noun: 'National Weather Service alerts and NOAA storm reports',
    sources: ['nws', 'spc'],
  },
  'federal-contracts-for-small-local-businesses': {
    noun: 'federal contract awards from USAspending.gov',
    sources: ['usaspending'],
  },
};

export interface GuideFact {
  /** Exact number of stored records dated in the window. Always > 0. */
  count: number;
  /** Distinct sources among the rows read. Exact when `feedsExact`, otherwise a lower bound. */
  feeds: number;
  feedsExact: boolean;
  /** occurred_at of the newest record dated up to now. */
  newestAt: string;
  /** When the count was taken. */
  asOf: string;
}

interface Row {
  source: string | null;
  occurred_at: string;
}

/**
 * Build the fact with the given client. Never throws. Returns null for: no spec, no client, a query error or timeout, or a zero count.
 * Exported so tests can pass a fake client.
 */
export async function buildGuideFact(sb: SupabaseClient | null, slug: string, now: Date): Promise<GuideFact | null> {
  const spec = GUIDE_DATA_SPECS[slug];
  if (!spec || !sb) return null;
  const sources = spec.sources.filter((s) => s !== HOLLER_REQUEST_SOURCE);
  if (sources.length === 0) return null;
  try {
    const until = now.toISOString();
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
    const r = await sb
      .from('holler_signals')
      .select('source, occurred_at', { count: 'exact' })
      .in('source', sources)
      .neq('source', HOLLER_REQUEST_SOURCE)
      .is(PROBATION_COLUMN, null)
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .order('occurred_at', { ascending: false })
      .limit(SAMPLE_ROWS)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (r.error) throw new Error(r.error.message);
    const rows = ((r.data ?? []) as unknown as Row[]).filter((x) => x.source && x.source !== HOLLER_REQUEST_SOURCE && sources.includes(x.source));
    const count = typeof r.count === 'number' ? r.count : 0;
    if (count <= 0 || rows.length === 0) return null;
    const newest = rows.find((x) => Date.parse(x.occurred_at) <= now.getTime());
    if (!newest) return null;
    return {
      count,
      feeds: new Set(rows.map((x) => x.source)).size,
      feedsExact: rows.length >= count,
      newestAt: newest.occurred_at,
      asOf: until,
    };
  } catch (e) {
    console.error('[seo] buildGuideFact failed:', slug, e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

const nf = (n: number) => n.toLocaleString('en-US');
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The sentence the page prints. Plain words: records read and stored, never demand or leads. */
export function guideFactText(slug: string, f: GuideFact): string | null {
  const spec = GUIDE_DATA_SPECS[slug];
  if (!spec || f.count <= 0) return null;
  const from =
    spec.feedNoun && f.feeds > 1 ? ` from ${f.feedsExact ? '' : 'at least '}${nf(f.feeds)} ${spec.feedNoun}` : '';
  return `In the ${WINDOW_DAYS} days to ${fmtDay(f.asOf)}, Holler read and stored ${nf(f.count)} ${spec.noun}${from}. The newest is dated ${fmtDay(f.newestAt)}. These are public records, not jobs or requests for work.`;
}

/**
 * Cached for about an hour, like /data. A miss (null) is kept for a minute only, so a database blip does not hide the line for an hour.
 */
export async function loadGuideFact(slug: string): Promise<GuideFact | null> {
  'use cache';
  const fact = await buildGuideFact(publicClient(), slug, new Date());
  cacheLife(fact ? { stale: 300, revalidate: 3600, expire: 7200 } : { stale: 60, revalidate: 60, expire: 300 });
  return fact;
}
