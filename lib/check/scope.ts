import { haversineMi, stateByCode } from '@/lib/geo';

/** What a new subscriber gets by default (radius_mi default in holler_profiles), so the checker shows what a subscription would send. */
export const CHECK_RADIUS_MI = 25;
/** Cache grid, in degrees. 0.25 degrees is about 17 miles north to south, so a few thousand cells cover the country. */
export const GRID_DEGREES = 0.25;
const MI_PER_DEG_LAT = 69;

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

export interface Box {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
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

/**
 * Bounding box that contains the circle of `miles` around any point inside the grid cell.
 * The longitude margin uses the widest parallel inside the box, so the box never undershoots at high latitudes.
 */
export function cellBox(cellLat: number, cellLon: number, miles: number = CHECK_RADIUS_MI): Box {
  const half = GRID_DEGREES / 2;
  const dLat = half + miles / MI_PER_DEG_LAT;
  const widestLat = Math.min(89, Math.max(Math.abs(cellLat - dLat), Math.abs(cellLat + dLat)));
  const dLon = half + miles / (MI_PER_DEG_LAT * Math.cos((widestLat * Math.PI) / 180));
  return { latMin: cellLat - dLat, latMax: cellLat + dLat, lonMin: cellLon - dLon, lonMax: cellLon + dLon };
}

/** A record with coordinates is shown when it is inside the radius around the ZIP itself, as the matcher would decide. */
export function withinRadius(
  zip: { lat: number; lon: number },
  item: { lat: number | null; lon: number | null },
  miles: number = CHECK_RADIUS_MI,
): boolean {
  if (item.lat == null || item.lon == null) return true; // state-level record, already limited to the ZIP's state
  return haversineMi(zip.lat, zip.lon, item.lat, item.lon) <= miles;
}
