import { createHmac } from 'node:crypto';

/**
 * Final review P2-1: a 311 row's stored point is rounded to 3 decimals (about 100 m, socrata.ts privatePosition), like violation and
 * inspection rows, because holler_signals is readable with the public key. The per-building heat count (repeat-marks.ts) still needs to
 * tell two buildings of one 100 m cell apart, across scans. So a NYC whole-building heat row is stored with `data.bref`: a keyed hash
 * (HMAC-SHA256, 20 hex characters) of its EXACT point at 4 decimals, the same building key as before. Without the secret the hash
 * cannot be matched to a point, so the public row no longer pins the building.
 *
 * The secret is HOLLER_BUILDING_REF_SECRET, else the service role key the scan already holds (it never leaves the server and is never
 * logged). Without either (tests, offline replays) no ref is written, and a rounded point gives no building key (the row makes no heat
 * card: fails closed, never one card for a whole block).
 */

export const HEAT_SOURCE = 'socrata-nyc-311';
const WHOLE_BUILDING_RE = /heat\/hot water \/ entire building/i;

/** A NYC "HEAT/HOT WATER / ENTIRE BUILDING" 311 row. */
export function isWholeBuildingHeat(sig: { source?: string | null; title?: string | null }): boolean {
  return sig.source === HEAT_SOURCE && WHOLE_BUILDING_RE.test(sig.title ?? '');
}

export const BUILDING_REF_RE = /^[0-9a-f]{20}$/;

export function buildingRefSecret(): string | null {
  const s = process.env.HOLLER_BUILDING_REF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return s ? s : null;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The keyed building reference of an exact point (4 decimals, as the old key). Null without a point or without a secret. */
export function buildingRefOf(lat: unknown, lon: unknown, secret: string | null = buildingRefSecret()): string | null {
  if (!finite(lat) || !finite(lon) || !secret) return null;
  return createHmac('sha256', `holler-building-ref|${secret}`).update(`${lat.toFixed(4)},${lon.toFixed(4)}`).digest('hex').slice(0, 20);
}

/** A point on the 3-decimal privacy grid: a stored, rounded point that cannot tell two buildings apart. */
export function onPrivacyGrid(lat: number, lon: number): boolean {
  return Math.round(lat * 1000) / 1000 === lat && Math.round(lon * 1000) / 1000 === lon;
}
