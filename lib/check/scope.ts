import { stateByCode } from '@/lib/geo';

/** How far back the free check reads, in days (lib/check/load.ts). The page says this number, so it is set once here. */
export const CHECK_WINDOW_DAYS = 30;

/** What a new subscriber gets by default (radius_mi default in holler_profiles). Used for the nearest-city lookup and the watch list, not for the records read. */
export const CHECK_RADIUS_MI = 25;

/**
 * Radius, in miles, of the records the checker reads: measured from the CENTRE of the grid cell the ZIP falls in (the cached query is keyed
 * on the cell, never on the ZIP), by great-circle distance in SQL (holler_signals_near). A ZIP can sit up to MAX_CELL_OFFSET_MI from its
 * cell centre, so 25 + 12.3 = 37.3 rounded up to 38 guarantees every record within 25 miles of any ZIP in the cell is read. The other
 * side of that guarantee: a record can be up to 38 + 12.3 = 50 miles from a ZIP at the far corner of its cell, 38 for a ZIP at the
 * centre. The page therefore says "within about 25 to 50 miles" and shows each record's real distance from the ZIP, never a flat "40".
 */
export const CHECK_SEARCH_RADIUS_MI = 38;
/**
 * Round 24 FIX2 (review D1): the radius of the LIST on /check. The page lists only what a member at the ZIP with the default area
 * (CHECK_RADIUS_MI) would have in their feed (lib/check/delivery.ts memberItems), so the list is "within 25 miles", not the read radius.
 */
export const CHECK_LIST_RADIUS_LABEL = `${CHECK_RADIUS_MI} miles`;
/** The honest wording for the radius above ("<trade> within about 25 to 50 miles of <ZIP place>"). */
export const CHECK_RADIUS_LABEL = 'about 25 to 50 miles';
/** Distance from a cell centre to its farthest corner: sqrt(2) * 0.125 degrees * 69.09 mi, at the equator where degrees are widest. */
export const MAX_CELL_OFFSET_MI = 12.3;
/**
 * Radius of the extra "close to home" read, from the cell centre: 25 - MAX_CELL_OFFSET_MI = 12.7 miles. Every record it returns is within
 * 25 miles of every ZIP in the cell, so a dense feed 30 to 38 miles out can never push the nearby rows off the page.
 */
export const CHECK_CORE_RADIUS_MI = 12.7;
/** Cache grid, in degrees. 0.25 degrees is about 17 miles north to south, so a few thousand cells cover the country. */
export const GRID_DEGREES = 0.25;

/** US territories and military mail codes. Holler has no source rows for these yet. */
export const UNCOVERED_STATE_CODES = ['PR', 'VI', 'GU', 'AS', 'MP', 'AA', 'AE', 'AP'];

export interface CheckScope {
  /** Centre of the grid cell the ZIP falls in. The cached query is keyed on this, never on the raw ZIP. */
  cellLat: number;
  cellLon: number;
  /** The ZIP's own two-letter state, used for state-level (no coordinates) records. */
  state: string;
  /** false for territories and military codes: Holler does not cover them yet. */
  covered: boolean;
}

function snap(v: number): number {
  return Math.round(v / GRID_DEGREES) * GRID_DEGREES;
}

/** Cache scope for a ZIP: coarse grid cell plus the ZIP's own state. */
export function deriveScope(zip: { lat: number; lon: number; state: string }): CheckScope {
  const state = zip.state.toUpperCase();
  return {
    cellLat: Number(snap(zip.lat).toFixed(2)),
    cellLon: Number(snap(zip.lon).toFixed(2)),
    state,
    covered: !!stateByCode(state) && !UNCOVERED_STATE_CODES.includes(state),
  };
}

/** Stable string form of the cache key. The raw ZIP never appears in it. */
export function scopeKey(scope: CheckScope, trade: string): string {
  return `${scope.cellLat.toFixed(2)}:${scope.cellLon.toFixed(2)}|${scope.state}|${trade}`;
}
