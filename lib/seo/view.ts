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

/** FNV-1a hash of a string, unsigned 32-bit. Deterministic across runs and servers. */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick in [0, n) from the city slug. `salt` keeps different blocks of one page independent. */
export function pickVariant(slug: string, salt: string, n: number): number {
  return hash32(`${salt}:${slug}`) % n;
}

/**
 * Short factual intro built only from counts and dates in the data. When data exists it leads with
 * the most notable real signal (active weather alerts, else the largest record group) and the
 * remaining sentences are ordered and phrased by one of three templates picked from the city slug.
 */
export function buildIntro(city: CityRef, data: PlaceData): string {
  const place = `${city.name}, ${city.state}`;
  const v = pickVariant(city.slug, 'intro', 3);
  if (!data.ok || data.total === 0 || !data.latestAt || !data.earliestAt) {
    return [
      `Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days. Scans run every 15 to 60 minutes, and new records appear here as they come in.`,
      `Nothing yet for ${place}. Holler has not recorded any public records there in the last ${WINDOW_DAYS} days, but it scans every 15 to 60 minutes and new records appear here as they come in.`,
      `This page is empty for now. Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days, and scans run every 15 to 60 minutes, so new records appear here as they come in.`,
    ][v];
  }

  const groupList = SECTIONS.map((s) => ({ s, n: data.counts[s.id] ?? 0 }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n);
  const top = groupList[0];
  const groups = groupList.slice(0, 3).map((g) => plural(g.n, g.s.noun[0], g.s.noun[1]));
  const alerts = data.counts.alerts ?? 0;
  const when = fmtDateTime(data.asOf);
  const count = plural(data.total, 'public record', 'public records');
  const range = `from ${fmtDate(data.earliestAt)} to ${fmtDate(data.latestAt)}`;

  let lead: string;
  if (alerts > 0) {
    lead = [
      `${plural(alerts, 'weather alert is', 'weather alerts are')} active in ${place} as of ${when}.`,
      `As of ${when}, ${plural(alerts, 'weather alert is', 'weather alerts are')} active in ${place}.`,
      `Active now in ${place}: ${plural(alerts, 'weather alert', 'weather alerts')}, as of ${when}.`,
    ][v];
  } else if (top) {
    const topText = plural(top.n, top.s.noun[0], top.s.noun[1]);
    lead = [
      `The largest group of records for ${place} is ${topText}.`,
      `Most common in ${place} lately: ${topText}.`,
      `${place} has ${topText} on record, more than any other group.`,
    ][v];
  } else {
    lead = `Holler has records for ${place}.`;
  }

  const counted = [
    `Holler recorded ${count} for ${place} in the last ${WINDOW_DAYS} days, ${range}.`,
    `Across the last ${WINDOW_DAYS} days Holler recorded ${count} for ${place}, ${range}.`,
    `Over the last ${WINDOW_DAYS} days Holler recorded ${count} here, ${range}.`,
  ][v];
  const groupsSentence = groups.length > 1 ? [` The largest groups: ${joinList(groups)}.`, alerts === 0 ? ` Next come ${joinList(groups.slice(1))}.` : ` The largest groups are ${joinList(groups)}.`, ` The biggest three are ${joinList(groups)}.`][v] : '';
  const radius = [
    `Records are tagged to ${city.name} when they fall within 40 miles of it.`,
    `Anything within 40 miles of ${city.name} is tagged to it.`,
    `A record counts for ${city.name} when it falls within 40 miles of it.`,
  ][v];
  return `${lead} ${counted}${groupsSentence} ${radius}`;
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
  const hasData = data.ok && data.total > 0 && !!data.latestAt;
  const v = (salt: string) => pickVariant(city.slug, `faq-${salt}`, 3);
  const sourceSentence = labels.length
    ? `For ${place}, the records on this page come from ${joinList(labels)}.`
    : `Holler reads official and open sources such as the National Weather Service, NOAA, FEMA, USGS, the FAA, USAspending.gov and city open data portals.`;
  const where = [
    `${sourceSentence} Every item on the page names its source and links to it. Holler does not scrape sites that forbid it.`,
    `${sourceSentence} Each item names its source and links to it, and Holler does not scrape sites that forbid it.`,
    `Every item names its source and links to it. ${sourceSentence} Holler does not scrape sites that forbid it.`,
  ][v('where')];
  const total = hasData ? plural(data.total, 'public record', 'public records') : '';
  const latest = hasData && data.latestAt ? fmtDate(data.latestAt) : '';
  const how = hasData
    ? [
        `Holler recorded ${total} for ${place} in the last ${WINDOW_DAYS} days. The most recent one is dated ${latest}. Records are tagged to ${city.name} when they fall within 40 miles of the city center.`,
        `The most recent record for ${place} is dated ${latest}, and Holler recorded ${total} in the last ${WINDOW_DAYS} days. Records are tagged to ${city.name} when they fall within 40 miles of the city center.`,
        `In the last ${WINDOW_DAYS} days Holler recorded ${total} for ${place}, the latest dated ${latest}. Anything within 40 miles of the city center is tagged to ${city.name}.`,
      ][v('how')]
    : [
        `Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days. Records are tagged to ${city.name} when they fall within 40 miles of the city center.`,
        `Nothing so far. Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days, and records are tagged to ${city.name} when they fall within 40 miles of the city center.`,
        `Holler has not recorded any public records for ${place} in the last ${WINDOW_DAYS} days. Anything within 40 miles of the city center would be tagged to ${city.name}.`,
      ][v('how')];
  const often = [
    `Holler scans its sources every 15 to 60 minutes, and this page refreshes about every 6 hours. The time of the last refresh is shown near the top.`,
    `Sources are scanned every 15 to 60 minutes. This page refreshes about every 6 hours, and the time of the last refresh is shown near the top.`,
    `This page refreshes about every 6 hours, and the time of the last refresh is shown near the top. Holler scans its sources every 15 to 60 minutes.`,
  ][v('often')];
  const alerts = [
    `Pick what your business does and how far you travel, and Holler emails you when something nearby matches. It costs $5 a month after a 7-day free trial, and no card is needed to start. Holler never posts anything for you.`,
    `Pick what your business does and how far you travel. Holler emails you when something nearby matches. It costs $5 a month after a 7-day free trial, with no card needed to start, and Holler never posts anything for you.`,
    `Holler emails you when something nearby matches what your business does and how far you travel, and you pick both. It costs $5 a month after a 7-day free trial. No card is needed to start, and Holler never posts anything for you.`,
  ][v('alerts')];
  return [
    { q: `Where does the ${city.name} information come from?`, a: where },
    { q: `How much has happened in ${place} lately?`, a: how },
    { q: `How often is this page updated?`, a: often },
    { q: `How do I get alerts for ${place}?`, a: alerts },
  ];
}

export { SECTIONS, SECTION_BY_ID };
