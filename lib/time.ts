/**
 * Signal times can be in the future: Ticketmaster events and event permits carry the time the event starts,
 * and a weather alert can carry an onset a few hours ahead. Everything that shows or sorts a signal time goes through here
 * so a future time never reads as "ago" or as a negative number, and far-future items never pin the top of a "latest" list.
 */

import { localizeDate, t, type Lang } from './i18n';

const MIN = 60_000;

/** Upcoming rows are read from the database only this far ahead. */
export const UPCOMING_DAYS = 14;

export function toMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : NaN;
}

/** True when the time is after `now` by more than a minute (clock skew between scanner and page is not "upcoming"). */
export function isUpcoming(iso: string, now: number = Date.now()): boolean {
  const t = toMs(iso);
  return Number.isFinite(t) && t - now > MIN;
}

function shortDate(ms: number, lang: Lang = 'en'): string {
  const en = new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return lang === 'en' ? en : (localizeDate(en, lang) ?? en);
}

/**
 * Past: "just now", "4 min ago", "3 hr ago", "2 days ago", then a short date after `dateAfterDays`.
 * Future: "in 12 min", "in 3 hr", "in 3 days", then a short date after `dateAfterDays`. Never negative, never "ago" for the future.
 * `style` 'email' keeps hours up to 48 and has no date cutoff for the past (the digest is read within hours).
 * `lang` 'es' gives "hace 4 min", "hace 3 h", "en 3 días" and "5 sep" (lib/i18n); the default 'en' is the wording above.
 */
export function relativeTime(iso: string, now: number = Date.now(), style: 'app' | 'email' = 'app', lang: Lang = 'en'): string {
  const tm = toMs(iso);
  if (!Number.isFinite(tm)) return '';
  const diff = tm - now;
  const future = diff > MIN;
  const abs = Math.abs(diff);
  if (!future && abs < (style === 'email' ? 2 * MIN : MIN)) return t(lang, 'time.just_now');
  const min = Math.round(abs / MIN);
  const label = (n: number, unit: 'min' | 'hr' | 'days' | 'day') => {
    if (lang === 'en') return future ? `in ${n} ${unit}` : `${n} ${unit} ago`;
    const keys = { min: ['time.in_min', 'time.min_ago'], hr: ['time.in_hr', 'time.hr_ago'], days: ['time.in_days', 'time.days_ago'], day: ['time.in_day', 'time.day_ago'] } as const;
    return t(lang, keys[unit][future ? 0 : 1], { n });
  };
  if (min < 60) return label(min, 'min');
  const hr = Math.round(min / 60);
  if (style === 'email') {
    if (hr < 48) return label(hr, 'hr');
    return label(Math.round(hr / 24), 'days');
  }
  if (hr < 24) return label(hr, 'hr');
  const day = Math.round(hr / 24);
  if (day < 14) return label(day, day === 1 ? 'day' : 'days');
  return shortDate(tm, lang);
}

/**
 * Display order for a "latest" list: upcoming items first, soonest start first, then everything else newest first.
 * An item counts as upcoming only if `upcoming(item)` says so (default: its time is in the future). Pass `maxUpcoming` to cap how
 * many upcoming items can lead the list; the rest of them are dropped (the database only reads UPCOMING_DAYS ahead, so they are few).
 * A non-upcoming item that has a future time is never reached here unless upcoming() says false, and is then ranked as "now".
 */
export function orderLatest<T>(items: T[], timeOf: (item: T) => string, now: number = Date.now(), opts: { maxUpcoming?: number } = {}): T[] {
  const up: T[] = [];
  const rest: T[] = [];
  for (const it of items) (isUpcoming(timeOf(it), now) ? up : rest).push(it);
  up.sort((a, b) => toMs(timeOf(a)) - toMs(timeOf(b)));
  rest.sort((a, b) => toMs(timeOf(b)) - toMs(timeOf(a)));
  const lead = opts.maxUpcoming === undefined ? up : up.slice(0, opts.maxUpcoming);
  return [...lead, ...rest];
}

/** The newest time that is not in the future, as ISO, or null. Used for "latest record" wording and sitemap lastmod. */
export function newestPast(isos: (string | null | undefined)[], now: number = Date.now()): string | null {
  let best = NaN;
  for (const iso of isos) {
    const t = toMs(iso);
    if (Number.isFinite(t) && t <= now + MIN && !(best >= t)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

