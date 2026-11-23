import type { StormReport } from './report';
import { MIN_SPC_REPORTS } from './report';

/** A city page is built from SPC places like "2 ESE Longview", so it says "near". A county page says "in". */
function near(r: Pick<StormReport, 'kind'>): string {
  return r.kind === 'city' ? 'near' : 'in';
}

export function h1(r: StormReport): string {
  return r.kind === 'state' ? `FEMA storm disaster declaration for ${r.name} on ${r.dateLabel}` : `Storm reports ${near(r)} ${r.place} on ${r.dateLabel}`;
}

export function pageTitle(r: StormReport): string {
  return `${h1(r)} | Holler`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 hail, 2 wind, 1 tornado": only the types that have a count. */
export function countList(r: Pick<StormReport, 'counts'>): string {
  const parts: string[] = [];
  if (r.counts.hail) parts.push(`${r.counts.hail} hail`);
  if (r.counts.wind) parts.push(`${r.counts.wind} wind`);
  if (r.counts.tornado) parts.push(`${r.counts.tornado} tornado`);
  return parts.join(', ');
}

function inches(n: number): string {
  return `${Number(n.toFixed(2))} ${n === 1 ? 'inch' : 'inches'}`;
}

export function metaDescription(r: StormReport): string {
  if (r.kind === 'state') {
    return `FEMA declared a storm disaster for ${r.name} on ${r.dateLabel}. See the declaration and its link to the official FEMA page.`;
  }
  return `${plural(r.spcTotal, 'storm report')} (${countList(r)}) ${near(r)} ${r.place} on ${r.dateLabel}, from the NOAA Storm Prediction Center, with a link to each source record.`;
}

/** Short factual summary built only from the counts and record values on the report. */
export function summary(r: StormReport): string[] {
  if (r.kind === 'state') {
    const rec = r.records.map((x) => x.detail).filter((d): d is string => !!d);
    return [
      `FEMA declared a storm related disaster for ${r.name} on ${r.dateLabel}.`,
      ...(rec.length ? [`${rec.join('. ')}.`] : []),
      'A declaration covers the designated areas named on the official FEMA page. It is not a count of storm reports.',
    ];
  }
  const lines: string[] = [
    `The NOAA Storm Prediction Center logged ${plural(r.spcTotal, 'storm report')} ${near(r)} ${r.place} on ${r.dateLabel}: ${countList(r)}.`,
  ];
  const facts: string[] = [];
  if (r.largestHailIn !== null) facts.push(`The largest hail reported was ${inches(r.largestHailIn)}.`);
  if (r.peakWindMph !== null) facts.push(`The highest wind gust reported was ${r.peakWindMph} mph.`);
  if (r.firstLabel && r.lastLabel) {
    facts.push(r.firstLabel === r.lastLabel ? `The report came in at ${r.firstLabel}.` : `Reports ran from ${r.firstLabel} to ${r.lastLabel}.`);
  }
  if (facts.length) lines.push(facts.join(' '));
  if (!r.qualifies) {
    lines.push(`That is fewer than the ${MIN_SPC_REPORTS} reports Holler needs before it lists a place in search, so this page is not indexed.`);
  }
  return lines;
}

export const FEMA_ONLY_NOTE = 'This page lists a federal disaster declaration from FEMA for this state.';

export const HOW_TO_READ =
  'These are preliminary reports from the Storm Prediction Center. They come from spotters, emergency managers and the public, and they can be revised or removed. Holler keeps hail of 1 inch or larger, wind of 50 mph or more or reported wind damage, and every tornado report. Times are local to the state\'s main time zone.';

/** Round 24 FIX2 (review D3): the closing line on a storm page whose place the ZIP check calls waitlist. No price, no trial. */
export const STORM_WAITLIST_LINE = 'Holler is not taking sign-ups for this area yet. Check your ZIP to see what Holler has where you work.';
export const SIGNUP_LINE = 'Holler alerts roofers, tree services and other local trades when reports like these come in near them.';
