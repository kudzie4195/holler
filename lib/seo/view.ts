import { FROM_MONTHLY } from '@/lib/plan/price-copy';
import { cadenceLong } from './cadence';
import { flagsFor, type Flags } from './public-copy';
import { sourceInfo } from './sources';
import { tradeLabel } from './trades';
import { KIND_NOUN, SECTIONS, SECTION_BY_ID } from './sections';
import { WINDOW_DAYS } from './threshold';
import type { PlaceData } from './summarize';
import { isUpcoming } from '../time';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { t } from '@/lib/i18n';
import { CITY_FEEDS, type SignalTypeId } from '@/lib/signals/capabilities';
import { SIGNAL_PHRASES } from './signal-types';
import { citySummary } from './week-summary';

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

/** Item time for a list row: "Nov 14, 18:30 UTC" for a past record, "Starts Dec 5, 19:00 UTC" for one that has not happened yet at `asOfIso`. */
export function fmtItemTime(iso: string, asOfIso: string): string {
  return isUpcoming(iso, Date.parse(asOfIso)) ? `Starts ${fmtDateTime(iso)}` : fmtDateTime(iso);
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
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
 * Short factual intro built only from counts and dates in the data. It opens with the place name, so no two city pages open alike, then
 * the most notable real signal (active weather alerts, else the largest record group).
 * Round 24 INT2 (COPY report section 9): when the page already shows the quotable summary sentence in its header (`summary`, from
 * lib/seo/week-summary.ts citySummary), the intro does not repeat a "Holler recorded N records" count; it says only what the summary does
 * not (the lead and the largest groups). A city with less data gets fewer sentences: no groups sentence with one group, no counts when
 * there is nothing to count. Phrasing variants still follow the city slug; which sentences appear follows the data only.
 */
export function buildIntro(city: CityRef, data: PlaceData, summary: string | null = citySummary(city, data)): string {
  const place = `${city.name}, ${city.state}`;
  const v = pickVariant(city.slug, 'intro', 3);
  if (!data.ok || data.total === 0 || !data.latestAt || !data.earliestAt) {
    return [
      `${place} has no public records on Holler from the last ${WINDOW_DAYS} days. New ones appear here as they come in.`,
      `${place} has nothing on this page yet. Holler has not recorded any public records there in the last ${WINDOW_DAYS} days, and new records appear here as their sources publish them.`,
      `${place} has an empty page for now. Records will show here as their sources publish them.`,
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
      `${place} has ${plural(alerts, 'weather alert', 'weather alerts')} active as of ${when}.`,
      `${place}: ${plural(alerts, 'weather alert is', 'weather alerts are')} active as of ${when}.`,
      `${place} is under ${plural(alerts, 'active weather alert', 'active weather alerts')} as of ${when}.`,
    ][v];
  } else if (top && groupList.length > 1) {
    // The largest group, then the next ones, in one sentence: no second sentence that repeats the first number.
    const topText = plural(top.n, top.s.noun[0], top.s.noun[1]);
    const rest = joinList(groups.slice(1));
    lead = [
      `${place} has more ${top.s.noun[1]} on record than anything else: ${topText}, then ${rest}.`,
      `${place}, lately: ${topText}, the most common kind of record, then ${rest}.`,
      `${place} has ${topText} on record, more than any other group, followed by ${rest}.`,
    ][v];
  } else if (top) {
    const topText = plural(top.n, top.s.noun[0], top.s.noun[1]);
    lead = `${place} has one kind of record on this page: ${topText}.`;
  } else {
    lead = `${place} has records on Holler.`;
  }

  // The header already carries the summary sentence (past 7 days); without it, the intro says what was counted.
  const counted = summary
    ? ''
    : [
        ` Holler recorded ${count} for ${place} in the last ${WINDOW_DAYS} days, ${range}.`,
        ` Across the last ${WINDOW_DAYS} days Holler recorded ${count} here, ${range}.`,
        ` Over the last ${WINDOW_DAYS} days Holler recorded ${count} here, ${range}.`,
      ][v];
  // With alerts in the lead, the largest groups follow in their own sentence; otherwise the lead already named them.
  const groupsSentence = alerts > 0 && groups.length > 1 ? [` The largest groups: ${joinList(groups)}.`, ` The largest groups are ${joinList(groups)}.`, ` The biggest three are ${joinList(groups)}.`][v] : '';
  return `${lead}${counted}${groupsSentence}`;
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

/** `flags` says which optional sources are on (default: the keys set on this deployment). With none on, the cadence names keyless sources only. */
/**
 * `answer` (round 24, review P1-2): the city's coverage answer (lib/seo/city-offer.ts cityOffer). The alerts answer offers the price and
 * the trial only on a live city; a limited city is told to check its ZIP first; a waitlist city gets no price and no trial at all. The
 * same list feeds the visible FAQ and the FAQPage structured data. Default live, the wording before round 24.
 *
 * Round 24 INT2 (COPY report section 9): the set of questions follows what is true for this city, 3 to 5 of them, never a random pick:
 *   where       always (the sources named are this page's own);
 *   city feeds  only where Holler reads a city or county feed for this place (CITY_FEEDS), naming those record kinds;
 *   how much    only when the page has records (the empty case is already said by the intro);
 *   how often   only when the page shows no refresh time or has no records (otherwise the header already shows it);
 *   ready for   only on a live city, naming the trades that are live there (lib/check/cells.ts, through `answer.live`);
 *   alerts      always, worded by the coverage answer.
 */
export function buildFaq(
  city: CityRef,
  data: PlaceData,
  flags: Flags = flagsFor(),
  answer: { state: 'live' | 'limited' | 'waitlist'; measured: boolean; live?: readonly string[] } = { state: 'live', measured: true },
): { q: string; a: string }[] {
  const place = `${city.name}, ${city.state}`;
  const labels = [...new Set(data.sources.map((s) => sourceInfo(s).label))];
  const hasData = data.ok && data.total > 0 && !!data.latestAt;
  const v = (salt: string) => pickVariant(city.slug, `faq-${salt}`, 3);
  const sourceSentence = labels.length
    ? `For ${place}, the records on this page come from ${joinList(labels)}.`
    : `Holler reads official and open sources such as the National Weather Service, NOAA, FEMA, USGS, the FAA, USAspending.gov and city open data portals.`;
  const sourcesNoScrape = `${sourceSentence.slice(0, -1)}, and Holler does not scrape sites that forbid it.`;
  const where = [
    `${sourcesNoScrape} Every item links to its public source.`,
    `Each item links to its public source. ${sourcesNoScrape}`,
    `Every item names its source and links to it. ${sourcesNoScrape}`,
  ][v('where')];
  const total = hasData ? plural(data.total, 'public record', 'public records') : '';
  const latest = hasData && data.latestAt ? fmtDate(data.latestAt) : '';
  const how = [
    `${capFirst(total)} in ${WINDOW_DAYS} days. The newest is dated ${latest}. Holler counts anything within 40 miles of the center of ${city.name}, so nearby towns show up here too.`,
    `${capFirst(total)} in the last ${WINDOW_DAYS} days, the newest dated ${latest}. Anything within 40 miles of the city center counts.`,
    `${capFirst(total)} since ${data.earliestAt ? fmtDate(data.earliestAt) : `${WINDOW_DAYS} days ago`}. The newest is dated ${latest}. Anything within 40 miles of the city center is tagged to ${city.name}.`,
  ][v('how')];
  const cadence = cadenceLong({ ask: flags.ask, event: flags.event });
  const often = `${cadence} This page refreshes about every 6 hours. Anything within 40 miles of the city center is tagged to ${city.name}.`;
  const feeds = (CITY_FEEDS[city.slug] ?? []).filter((k) => k !== 'airport');
  const feedsAnswer = feeds.length
    ? `${capFirst(joinList(feeds.map((k) => SIGNAL_PHRASES[k as SignalTypeId])))}. A city or county near ${place} publishes those as open data, and Holler reads them a few times a day. Weather and storm reports come from national sources.`
    : '';
  const live = answer.state === 'live' ? [...(answer.live ?? [])] : [];
  const ready = live.length
    ? `${capFirst(joinList(live.map((id) => tradeLabel(id).toLowerCase())))}. For ${live.length === 1 ? 'that trade' : 'those trades'} Holler measured enough public records near ${city.name} to offer the free trial. The list above shows what it has for the other launch trades.`
    : '';
  const alerts = [
    `Sign up and pick your trade. Holler emails you when something nearby matches what you do and how far you travel, and plans start at ${FROM_MONTHLY} a month after a ${TRIAL_PHRASE} with no card needed to start.`,
    `Plans start at ${FROM_MONTHLY} a month after a ${TRIAL_PHRASE}, and no card is needed to start. Pick your trade and how far you travel, and Holler emails you when something nearby matches.`,
    `Sign up and pick your trade. Holler emails you when something nearby matches what your business does and how far you travel. Plans start at ${FROM_MONTHLY} a month after a ${TRIAL_PHRASE}, and no card is needed.`,
  ][v('alerts')];
  const alertsAnswer =
    answer.state === 'live'
      ? alerts
      : answer.state === 'waitlist'
        ? t('en', 'city.faq.alerts.waitlist', { place })
        : t('en', answer.measured ? 'city.faq.alerts.limited' : 'city.faq.alerts.unmeasured', { place, monthly: FROM_MONTHLY, trial: TRIAL_PHRASE });
  const faq: { q: string; a: string }[] = [{ q: `Where does the ${city.name} information come from?`, a: where }];
  if (feedsAnswer) faq.push({ q: `Which city records does Holler read for ${city.name}?`, a: feedsAnswer });
  if (hasData) faq.push({ q: `How much has happened in ${place} lately?`, a: how });
  if (!data.ok || !hasData) faq.push({ q: `How often is this page updated?`, a: often });
  if (ready) faq.push({ q: `Which trades is Holler ready for in ${city.name}?`, a: ready });
  faq.push({ q: `How do I get alerts for ${place}?`, a: alertsAnswer });
  return faq;
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { SECTIONS, SECTION_BY_ID };
