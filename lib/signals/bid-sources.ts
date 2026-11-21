/**
 * City open bids (kind 'contract', data.subtype 'bid'): source ids, the feature flag and the one test for "is this a bid".
 * Pure and client-safe: no server imports, so match.ts, approx-location.ts and the cards can all use it.
 *
 * HOLLER_BIDS_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any case). Off means: the bid adapters do not run (run.ts, and
 * their own fetch returns nothing) and any bid row already stored is never matched (match.ts), so no bid reaches a member's feed,
 * push or digest. The default is off so shipping this code changes nothing until the owner flips the flag.
 */
export const BIDS_FLAG = 'HOLLER_BIDS_ENABLED';

/** Every city-bid source id the code knows. A source can be configured here and still be disabled (see city-bids.ts `verified`). */
export const BID_SOURCE_IDS: readonly string[] = ['bids-sf', 'bids-la', 'bids-batonrouge', 'bids-nyc'];

const ON = new Set(['1', 'true', 'on', 'yes']);

/** Reads the flag at call time (not at import), so a test or a redeploy with a new value takes effect without a rebuild of this module. */
export function bidsEnabled(value: string | undefined = process.env[BIDS_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

/** True for a stored or fresh signal that is a city bid: data.subtype 'bid' or one of the bid sources. Accepts a feed row, a match row or a SignalInput. */
export function isBidSignal(s: { source?: string | null; subtype?: unknown; data?: { subtype?: unknown } | null } | null | undefined): boolean {
  if (!s) return false;
  const sub = typeof s.subtype === 'string' && s.subtype ? s.subtype : s.data?.subtype;
  if (sub === 'bid') return true;
  return typeof s.source === 'string' && BID_SOURCE_IDS.includes(s.source);
}

/**
 * True when a record must be hidden from members right now: a city bid while the flag is off. Used where stored matches are read for a
 * member (web feed, mobile feed, email digest, push), so turning the flag off removes bids members already have, not just new ones.
 * Pass `on` in tests; by default the flag is read at call time.
 */
export function bidHidden(
  s: { source?: string | null; subtype?: unknown; data?: { subtype?: unknown } | null } | null | undefined,
  on: boolean = bidsEnabled(),
): boolean {
  return !on && isBidSignal(s);
}

/** The matches whose signal is not a hidden city bid: what a member-facing read keeps. `signal` may be an object, a one-item array or null. */
export function dropHiddenBids<T extends { signal: unknown }>(matches: T[], on: boolean = bidsEnabled()): T[] {
  if (on) return matches;
  return matches.filter((m) => {
    const s = Array.isArray(m.signal) ? m.signal[0] : m.signal;
    return !bidHidden(s as Parameters<typeof bidHidden>[0], on);
  });
}
