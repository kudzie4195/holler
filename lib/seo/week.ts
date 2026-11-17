/**
 * Weekly page dates. A weekly page is /local/<state>/<city>/week/<YYYY-MM-DD> where the date is the Monday (UTC)
 * that starts an ISO week. Only the current week and the 11 before it exist (12 in all); every other date, a date that
 * is not a Monday and anything malformed is a 404. Pure and dependency free so proxy.ts can import it through route-check.
 */

const DAY = 86_400_000;
export const WEEK_MS = 7 * DAY;
/** The current week plus the previous 11. */
export const WEEK_WINDOW = 12;
/** A weekly page is indexable only with at least this many records in its week. */
export const WEEK_INDEX_MIN = 10;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Monday 00:00 UTC of the ISO week that contains `ms`. */
export function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day - ((d.getUTCDay() + 6) % 7) * DAY;
}

/** "2026-11-16" for a UTC time. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type WeekParseFailure = 'format' | 'monday' | 'future' | 'too-old';
export type WeekParse = { ok: true; startMs: number; iso: string } | { ok: false; reason: WeekParseFailure };

/** Validate a `week` URL segment against `nowMs`. Strict: no trimming, no other formats, no impossible dates. */
export function parseWeek(param: string, nowMs: number): WeekParse {
  const m = DATE_RE.exec(param);
  if (!m) return { ok: false, reason: 'format' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const startMs = Date.UTC(y, mo - 1, d);
  const back = new Date(startMs);
  // Round trip rejects 2026-02-30, month 13 and the two-digit-year quirk of Date.UTC.
  if (!Number.isFinite(startMs) || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return { ok: false, reason: 'format' };
  }
  if (back.getUTCDay() !== 1) return { ok: false, reason: 'monday' };
  const current = mondayOf(nowMs);
  if (startMs > current) return { ok: false, reason: 'future' };
  if (startMs < current - (WEEK_WINDOW - 1) * WEEK_MS) return { ok: false, reason: 'too-old' };
  return { ok: true, startMs, iso: isoDay(startMs) };
}

/** Last instant of the week, exclusive upper bound is `startMs + WEEK_MS`. */
export function weekEndExclusive(startMs: number): number {
  return startMs + WEEK_MS;
}

/** True for the week that contains `nowMs`. */
export function isCurrentWeek(startMs: number, nowMs: number): boolean {
  return startMs === mondayOf(nowMs);
}

/** Adjacent weeks that exist: previous only inside the 12 week window, next only when it has started. */
export function weekNeighbors(startMs: number, nowMs: number): { prev: string | null; next: string | null } {
  const current = mondayOf(nowMs);
  const prev = startMs - WEEK_MS;
  const next = startMs + WEEK_MS;
  return {
    prev: prev >= current - (WEEK_WINDOW - 1) * WEEK_MS ? isoDay(prev) : null,
    next: next <= current ? isoDay(next) : null,
  };
}

/** Monday of this week and last week, as ISO dates, for the city page links. */
export function thisAndLastWeek(nowMs: number): { thisWeek: string; lastWeek: string } {
  const current = mondayOf(nowMs);
  return { thisWeek: isoDay(current), lastWeek: isoDay(current - WEEK_MS) };
}

export function isWeekIndexable(records: number): boolean {
  return Number.isFinite(records) && records >= WEEK_INDEX_MIN;
}

/** Path of a weekly page given the city page path, e.g. weekPath('/local/georgia/atlanta-ga', '2026-11-09'). */
export function weekPath(cityPagePath: string, iso: string): string {
  return `${cityPagePath}/week/${iso}`;
}
