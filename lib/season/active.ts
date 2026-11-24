import { haversineMi } from '@/lib/geo';
import { measuredCentres } from '@/lib/check/cells';
import { CHECK_RADIUS_MI } from '@/lib/check/scope';
import { expandTradeIds } from '@/lib/plan/composite-trades';
import { SEASON_TABLE, type SeasonRow } from './table';

/**
 * Round 30: the season rows that apply to one place, a member's trades and one day (lib/season/table.ts).
 *
 * A row applies when ALL hold:
 *   - its metro centre (lib/check/cells.ts measuredCentres: the coordinates the coverage gate already uses, none typed here) is within
 *     25 miles (CHECK_RADIUS_MI) of the point, by the same haversineMi;
 *   - one of its trades is one of the member's trades; the "Pressure washing" chip counts as cleaning and siding-gutters (expandTradeIds);
 *     a trade the row also lists in `allTrades` counts only when the member holds every id there (rowReachedBy, review D4);
 *   - its window contains the day, inclusive, in the metro's own calendar (a window whose end is before its start runs over New Year).
 * Then: one row per id and per topic (the nearer centre wins a topic), ordered by how many days the day is from the row's peak (or the
 * window's midpoint), at most MAX_SEASON_LINES. Nothing applies: an empty list, and every surface stays exactly as it was.
 */
export const MAX_SEASON_LINES = 2;

/** The calendar each centre lives in, so "Dec 1" is the metro's own Dec 1 and not UTC's. */
const CENTRE_TZ: Record<string, string> = {
  atlanta: 'America/New_York',
  charlotte: 'America/New_York',
  raleigh: 'America/New_York',
  austin: 'America/Chicago',
};

const DAY_MS = 86_400_000;

/** 'MM-DD' to a day number in a fixed non-leap year (1..365); Feb 29 counts as Feb 28. */
export function dayOfYear(md: string): number {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return NaN;
  const month = Number(m[1]);
  const day = Math.min(Number(m[2]), month === 2 ? 28 : 31);
  return Math.round((Date.UTC(2025, month - 1, day) - Date.UTC(2025, 0, 1)) / DAY_MS) + 1;
}

/** True when 'MM-DD' `md` is inside the inclusive window; a window with end before start wraps over New Year. */
export function inWindow(md: string, start: string, end: string): boolean {
  const d = dayOfYear(md);
  const s = dayOfYear(start);
  const e = dayOfYear(end);
  if (![d, s, e].every(Number.isFinite)) return false;
  return s <= e ? d >= s && d <= e : d >= s || d <= e;
}

/** Days between two 'MM-DD' on a 365-day circle (0..182). */
function circularDays(a: string, b: string): number {
  const diff = Math.abs(dayOfYear(a) - dayOfYear(b)) % 365;
  return Math.min(diff, 365 - diff);
}

/** The row's peak, or the midpoint of its window when it has none, as a day number. */
function peakDay(row: SeasonRow): string {
  if (row.peak) return row.peak;
  const s = dayOfYear(row.start);
  const e = dayOfYear(row.end);
  const len = s <= e ? e - s : 365 - s + e;
  const mid = ((s - 1 + Math.floor(len / 2)) % 365) + 1;
  const date = new Date(Date.UTC(2025, 0, mid));
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** The 'MM-DD' of a day: a 'YYYY-MM-DD' string as it is, a Date in the given time zone. */
export function monthDayOf(date: Date | string, tz: string = 'UTC'): string | null {
  if (typeof date === 'string') {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(date);
    return m ? `${m[1]}-${m[2]}` : null;
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(date);
  const mm = parts.find((p) => p.type === 'month')?.value;
  const dd = parts.find((p) => p.type === 'day')?.value;
  return mm && dd ? `${mm}-${dd}` : null;
}

export interface ActiveSeasonInput {
  lat: number | null | undefined;
  lon: number | null | undefined;
  /** The member's (or the visitor's) trade ids; the "pressure-washing" chip is expanded here. */
  trades: readonly string[] | null | undefined;
  /** The day: a Date (read in each metro's own time zone) or 'YYYY-MM-DD'. */
  date: Date | string;
  /** The table to read. Tests only; the default is the one table. */
  table?: readonly SeasonRow[];
}

/**
 * True when the member's (already expanded) trades reach the row: one of `row.trades` is held, and when that trade is also in
 * `row.allTrades`, every id in `row.allTrades` is held too. So a pressure-washing row (allTrades cleaning + siding-gutters) skips a
 * house-cleaning-only member, while a listing-prep row still reaches a landscaper through landscaping alone.
 */
export function rowReachedBy(row: Pick<SeasonRow, 'trades' | 'allTrades'>, trades: readonly string[]): boolean {
  const all = row.allTrades ?? [];
  const allHeld = all.every((t) => trades.includes(t));
  return row.trades.some((t) => trades.includes(t) && (allHeld || !all.includes(t)));
}

export function activeSeasons(input: ActiveSeasonInput): SeasonRow[] {
  const { lat, lon } = input;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const trades = expandTradeIds(Array.isArray(input.trades) ? input.trades : []);
  if (trades.length === 0) return [];
  const centres = new Map(measuredCentres().map((c) => [c.id, c]));
  const hits: { row: SeasonRow; miles: number; fromPeak: number; order: number }[] = [];
  (input.table ?? SEASON_TABLE).forEach((row, order) => {
    const c = centres.get(row.centre);
    if (!c) return;
    const miles = haversineMi(lat, lon, c.lat, c.lon);
    if (!(miles <= CHECK_RADIUS_MI)) return;
    if (!rowReachedBy(row, trades)) return;
    const md = monthDayOf(input.date, CENTRE_TZ[row.centre] ?? 'UTC');
    if (!md || !inWindow(md, row.start, row.end)) return;
    hits.push({ row, miles, fromPeak: circularDays(md, peakDay(row)), order });
  });
  // One row per topic: the nearest centre's.
  const byTopic = new Map<string, (typeof hits)[number]>();
  for (const h of hits) {
    const was = byTopic.get(h.row.topic);
    if (!was || h.miles < was.miles) byTopic.set(h.row.topic, h);
  }
  const seen = new Set<string>();
  return [...byTopic.values()]
    .sort((a, b) => a.fromPeak - b.fromPeak || a.order - b.order)
    .map((h) => h.row)
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .slice(0, MAX_SEASON_LINES);
}

/** What a surface prints for one row: the line in the reader's language and its public source. */
export interface SeasonLine {
  id: string;
  text: string;
  source: string;
}

export function seasonLines(rows: readonly SeasonRow[], lang: string): SeasonLine[] {
  return rows.map((r) => ({ id: r.id, text: lang === 'es' ? r.es : r.en, source: r.source }));
}

/**
 * The season line in the alert and quiet-week emails is sent only while HOLLER_SEASON_ENABLED is exactly "1" (read at call time). Unset
 * (the default): the notify cron makes the same database calls and sends byte-identical emails as before round 30. /check needs no switch.
 */
export function seasonEmailEnabled(value: string | undefined = process.env.HOLLER_SEASON_ENABLED): boolean {
  return value === '1';
}
