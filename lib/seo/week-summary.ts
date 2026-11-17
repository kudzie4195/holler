import type { SectionId } from './sections';
import type { PlaceData } from './summarize';
import { TITLE_PRIORITY, isCountyFeed, joinList } from './titles';
import { fmtDate } from './view';
import { WEEK_MS, isCurrentWeek } from './week';

/**
 * The one quotable sentence at the top of a city page and of a weekly page. It is built only from real counts of records that
 * already happened, names only types with a count above zero, in the title priority order, at most four, and says "area" where a
 * type comes from a county feed (same rule as titles.ts). With nothing to count it returns null and the page leaves the sentence out.
 */
export const MAX_SUMMARY_TYPES = 4;

/** [singular, plural]. Same priority order as the page titles; alerts are "issued" in the period, so they are not called active. */
const NOUNS: Partial<Record<SectionId, [string, string]>> = {
  permits: ['building permit', 'building permits'],
  storm: ['storm report', 'storm reports'],
  alerts: ['weather alert', 'weather alerts'],
  requests311: ['311 request', '311 requests'],
  inspections: ['inspection record', 'inspection records'],
  business: ['new business license', 'new business licenses'],
  violations: ['code violation', 'code violations'],
  contracts: ['federal contract', 'federal contracts'],
  events: ['event', 'events'],
};

export interface SummaryInput {
  /** "Raleigh, NC" */
  place: string;
  /** city slug, for the county wording */
  slug?: string;
  /** counts of records that already happened in the period */
  counts: Partial<Record<SectionId, number>>;
  /** Leading phrase, such as "In the 7 days to Nov 17, 2026". It is followed by a comma. */
  period: string;
  /** True when the counts are lower bounds (the row query hit its cap): every number is then "at least". */
  lowerBound?: boolean;
}

/** "42 building permits", "1 area building permit", "at least 3 storm reports". Types with no records are left out. */
export function summaryParts(input: Pick<SummaryInput, 'slug' | 'counts' | 'lowerBound'>): string[] {
  const out: string[] = [];
  for (const t of TITLE_PRIORITY) {
    const n = input.counts[t.id] ?? 0;
    const noun = NOUNS[t.id];
    if (!noun || !(n > 0)) continue;
    const word = n === 1 ? noun[0] : noun[1];
    const area = isCountyFeed(t.id, input.slug) ? 'area ' : '';
    out.push(`${input.lowerBound ? 'at least ' : ''}${n.toLocaleString('en-US')} ${area}${word}`);
    if (out.length === MAX_SUMMARY_TYPES) break;
  }
  return out;
}

export function buildSummarySentence(input: SummaryInput): string | null {
  const parts = summaryParts(input);
  if (!parts.length) return null;
  return `${input.period}, ${input.place} had ${joinList(parts)}.`;
}

/** "In the 7 days to Nov 17, 2026" for the city page, dated by the moment the counts were computed. */
export function sevenDayPeriod(asOfIso: string): string {
  return `In the 7 days to ${fmtDate(asOfIso)}`;
}

function dayRange(fromMs: number, toMs: number): string {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  if (from.slice(0, 10) === to.slice(0, 10)) return fmtDate(to);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fmtDate(from).replace(/, \d{4}$/, '')} to ${fmtDate(to)}`;
  return `${fmtDate(from)} to ${fmtDate(to)}`;
}

/**
 * Leading phrase for a weekly page. A finished week is "In the week of Nov 9 to Nov 15, 2026". The current week is still open, so it
 * runs from Monday to the day the counts were computed: "From Nov 16 to Nov 17, 2026" or, on a Monday, "On Nov 16, 2026".
 */
export function weekPeriod(startMs: number, asOfMs: number): string {
  if (isCurrentWeek(startMs, asOfMs)) {
    const range = dayRange(startMs, asOfMs);
    return range.includes(' to ') ? `From ${range}` : `On ${range}`;
  }
  return `In the week of ${dayRange(startMs, startMs + WEEK_MS - 1)}`;
}

/** The city page sentence: past-only counts of the last 7 days, or null when there is nothing to count (the intro covers that case). */
export function citySummary(city: { name: string; state: string; slug: string }, data: PlaceData): string | null {
  if (!data.ok) return null;
  return buildSummarySentence({
    place: `${city.name}, ${city.state}`,
    slug: city.slug,
    counts: data.pastWeekCounts,
    period: sevenDayPeriod(data.asOf),
    lowerBound: !data.pastWeekExact,
  });
}
