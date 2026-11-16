import { sourceInfo } from './sources';
import { tradeLabel } from './trades';
import { KIND_NOUN, SECTIONS, SECTION_BY_ID } from './sections';
import { WINDOW_DAYS } from './threshold';
import type { PlaceData } from './summarize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 14, 2026" (UTC). Deterministic, no Intl. */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Nov 14, 18:30 UTC" */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export interface CityRef {
  name: string;
  state: string;
  slug: string;
}

/** Short factual intro built only from counts and dates in the data. */
export function buildIntro(city: CityRef, data: PlaceData): string {
  const place = `${city.name}, ${city.state}`;
  if (!data.ok || data.total === 0 || !data.latestAt || !data.earliestAt) {
    return `Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days. Scans run every 15 to 60 minutes, and new records appear here as they come in.`;
  }
  const first = `Holler recorded ${plural(data.total, 'public record', 'public records')} for ${place} in the last ${WINDOW_DAYS} days, from ${fmtDate(data.earliestAt)} to ${fmtDate(data.latestAt)}.`;
  const groups = SECTIONS.map((s) => ({ s, n: data.counts[s.id] ?? 0 }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((g) => plural(g.n, g.s.noun[0], g.s.noun[1]));
  const second = groups.length ? ` The largest groups: ${joinList(groups)}.` : '';
  const alerts = data.counts.alerts ?? 0;
  const third = alerts > 0 ? ` ${plural(alerts, 'weather alert is', 'weather alerts are')} active as of ${fmtDateTime(data.asOf)}.` : '';
  const fourth = ` Records are tagged to ${city.name} when they fall within 40 miles of it.`;
  return first + second + third + fourth;
}

/** First sentence(s) of the intro, trimmed for a meta description (max 155 chars). */
export function buildDescription(city: CityRef, data: PlaceData): string {
  const place = `${city.name}, ${city.state}`;
  let d: string;
  if (data.ok && data.total > 0) {
    d = `${plural(data.total, 'public record', 'public records')} for ${place} in the last ${WINDOW_DAYS} days: weather alerts, storm reports, permits, 311, contracts and events, each with its source.`;
  } else {
    d = `Local weather alerts, storm reports, permits, 311 requests, contracts and events for ${place}, each with its source.`;
  }
  return d.length <= 155 ? d : `${d.slice(0, 152).trimEnd()}...`;
}

export interface HelpsBlock {
  heading: string;
  rows: { id: string; label: string; count: number; from: string }[];
}

/** Who this week's activity helps: trades with counts. Falls back to the 60-day window if the week is empty. */
export function buildHelps(data: PlaceData, max = 8): HelpsBlock | null {
  const useWeek = data.weekTrades.length > 0;
  const src = useWeek ? data.weekTrades : data.windowTrades;
  if (!src.length) return null;
  return {
    heading: useWeek ? "Who this week's activity helps" : `Who the last ${WINDOW_DAYS} days of activity helps`,
    rows: src.slice(0, max).map((t) => ({
      id: t.id,
      label: tradeLabel(t.id),
      count: t.count,
      from: joinList(t.kinds.slice(0, 2).map((k) => KIND_NOUN[k] ?? k)),
    })),
  };
}

export function buildFaq(city: CityRef, data: PlaceData): { q: string; a: string }[] {
  const place = `${city.name}, ${city.state}`;
  const labels = [...new Set(data.sources.map((s) => sourceInfo(s).label))];
  const sourceSentence = labels.length
    ? `For ${place}, the records on this page come from ${joinList(labels)}.`
    : `Holler reads official and open sources such as the National Weather Service, NOAA, FEMA, USGS, the FAA, USAspending.gov and city open data portals.`;
  const countSentence =
    data.ok && data.total > 0 && data.latestAt
      ? `Holler recorded ${plural(data.total, 'public record', 'public records')} for ${place} in the last ${WINDOW_DAYS} days. The most recent one is dated ${fmtDate(data.latestAt)}.`
      : `Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days.`;
  return [
    {
      q: `Where does the ${city.name} information come from?`,
      a: `${sourceSentence} Every item on the page names its source and links to it. Holler does not scrape sites that forbid it.`,
    },
    {
      q: `How much has happened in ${place} lately?`,
      a: `${countSentence} Records are tagged to ${city.name} when they fall within 40 miles of the city center.`,
    },
    {
      q: `How often is this page updated?`,
      a: `Holler scans its sources every 15 to 60 minutes, and this page refreshes about every 6 hours. The time of the last refresh is shown near the top.`,
    },
    {
      q: `How do I get alerts for ${place}?`,
      a: `Pick what your business does and how far you travel, and Holler emails you when something nearby matches. It costs $5 a month after a 7-day free trial, and no card is needed to start. Holler never posts anything for you.`,
    },
  ];
}

export { SECTIONS, SECTION_BY_ID };
