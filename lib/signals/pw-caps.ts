import { haversineMi } from '@/lib/geo';
import { siteAddressFromSummary } from './permit-value';

/**
 * Round 35 review (P1-1, P2-3): volume limits on a pressure-washing member's cards (HOLLER_PW_RULES_ENABLED on, lib/signals/pw-switch.ts).
 * Pure: the scan and the rematch pass what the member already got in the last 7 days (lib/signals/pw-history.ts reads it), the replay and
 * the tests pass an in-memory history.
 *
 *   graffiti   private-property graffiti (lead-rules.ts pwRuleOf kind 'graffiti') is a heads-up, at most PW_GRAFFITI_PER_DAY a UTC day
 *              per member (the rest stay in the feed as held cards, never emailed or pushed), and at most one card per block per 7 days
 *              (a second request on the same block within PW_BLOCK_MI is not stored). San Francisco: 94 requests in 5.3 days of 311
 *              rows, up to 28 a day, which would bury the permits this rule set exists for.
 *   building   one card per building or complex per 7 days: permits on the same street within PW_SAME_BUILDING_NUMBERS house numbers
 *              (Los Angeles Canoga Ave buildings A to D; New Orleans 523 and 527 Dumaine St, one project), or at the same point when no
 *              street is printed. The first one kept is the card; the others are not stored.
 */
export const PW_GRAFFITI_PER_DAY = 3;
export const PW_WINDOW_DAYS = 7;
/** A block: two graffiti requests within this distance are the same block. */
export const PW_BLOCK_MI = 0.06;
/** Two permits on one street within this many house numbers are one building or complex. */
export const PW_SAME_BUILDING_NUMBERS = 100;
const SAME_POINT_MI = 0.03;
const DAY = 86_400_000;

export type PwCapKind = 'graffiti' | 'building';

/** Where a capped card is: a block (graffiti) or a building (a permit's street and house number, else its point). */
export interface PwPlace {
  kind: PwCapKind;
  street: string | null;
  num: number | null;
  lat: number | null;
  lon: number | null;
}

/** One card the member already holds, for the caps: where, when it was stored, and whether it went out (no hold). */
export interface PwPast {
  place: PwPlace;
  at: number;
  alert: boolean;
}

const UNIT_RE = /\s+(?:bldg\.?|building|ste\.?|suite|unit|apt\.?|#|fl\.?|floor)\s*[\w-]*$/i;

/** The street of a permit's site address without house number and unit, upper case ("N CANOGA AVE"), and its house number. */
export function streetOf(summary: string | null | undefined): { street: string; num: number | null } | null {
  const site = siteAddressFromSummary(summary);
  if (!site) return null;
  let a = site.address.toUpperCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && UNIT_RE.test(a); i++) a = a.replace(UNIT_RE, '').trim();
  const m = /^(\d+)(?:-\d+)?[A-Z]?\s+(.+)$/.exec(a);
  if (!m) return { street: a, num: null };
  return { street: m[2].trim(), num: Number(m[1]) };
}

const hasPoint = (lat: number | null | undefined, lon: number | null | undefined) => typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);

/** The place of a capped card, or null when the card is not capped. `kind` comes from the pw rule (pwRuleOf). */
export function pwPlaceOf(kind: string | null | undefined, sig: { summary?: string | null; lat?: number | null; lon?: number | null; subtype?: string | null; kind?: string | null }): PwPlace | null {
  const lat = hasPoint(sig.lat, sig.lon) ? (sig.lat as number) : null;
  const lon = lat !== null ? (sig.lon as number) : null;
  if (kind === 'graffiti') return { kind: 'graffiti', street: null, num: null, lat, lon };
  const permit = (sig.subtype ?? '').toLowerCase() === 'permit' || (sig.kind ?? '').toLowerCase() === 'permit';
  if (!permit) return null;
  const st = streetOf(sig.summary);
  if (!st && lat === null) return null;
  return { kind: 'building', street: st?.street ?? null, num: st?.num ?? null, lat, lon };
}

/** Two places are the same block (graffiti) or the same building or complex (permits). */
export function samePlace(a: PwPlace, b: PwPlace): boolean {
  if (a.kind !== b.kind) return false;
  const near = (mi: number) => a.lat !== null && b.lat !== null && haversineMi(a.lat, a.lon as number, b.lat, b.lon as number) <= mi;
  if (a.kind === 'graffiti') return near(PW_BLOCK_MI);
  if (a.street && b.street) {
    if (a.street !== b.street) return false;
    if (a.num === null || b.num === null) return a.num === b.num;
    return Math.abs(a.num - b.num) <= PW_SAME_BUILDING_NUMBERS;
  }
  return near(SAME_POINT_MI);
}

const dayOf = (ms: number) => Math.floor(ms / DAY);

/**
 * The caps for one member's cards of one scan, in the order they are kept (best first). Returns, per card: 'keep' (as it is), 'hold'
 * (stored, feed only: over today's graffiti cap) or 'drop' (not stored: a second card for a block or building this week). Cards whose
 * place is null are kept as they are. `past` is what the member already holds (any order). `historyKnown` false (the read failed): every
 * graffiti alert is held, so a failed read can never send more than the cap.
 */
export function pwCapDecisions(
  cards: ReadonlyArray<{ place: PwPlace | null; alert: boolean }>,
  past: readonly PwPast[],
  nowMs: number,
  historyKnown = true,
): Array<'keep' | 'hold' | 'drop'> {
  const since = nowMs - PW_WINDOW_DAYS * DAY;
  const seen: PwPlace[] = past.filter((p) => p.at >= since).map((p) => p.place);
  let today = past.filter((p) => p.place.kind === 'graffiti' && p.alert && dayOf(p.at) === dayOf(nowMs)).length;
  return cards.map((c) => {
    if (!c.place) return 'keep';
    const place = c.place;
    if (seen.some((s) => samePlace(s, place))) return 'drop';
    seen.push(place);
    if (place.kind !== 'graffiti' || !c.alert) return 'keep';
    if (!historyKnown || today >= PW_GRAFFITI_PER_DAY) return 'hold';
    today++;
    return 'keep';
  });
}

/**
 * The caps over a stretch of time, one card at a time in date order, as if each card had arrived in its own scan on its own day: what the
 * replay, /check and the measurement count. Returns the decision per input card (same order as `cards`).
 */
export function pwCapTimeline(cards: ReadonlyArray<{ place: PwPlace | null; alert: boolean; at: number }>): Array<'keep' | 'hold' | 'drop'> {
  const order = cards.map((c, i) => ({ c, i })).sort((a, b) => a.c.at - b.c.at || a.i - b.i);
  const past: PwPast[] = [];
  const out: Array<'keep' | 'hold' | 'drop'> = new Array(cards.length);
  for (const { c, i } of order) {
    const [d] = pwCapDecisions([c], past, c.at);
    out[i] = d;
    if (d !== 'drop' && c.place) past.push({ place: c.place, at: c.at, alert: d === 'keep' && c.alert });
  }
  return out;
}
