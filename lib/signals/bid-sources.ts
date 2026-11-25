import { PAGE_WATCH_IDS } from './adapters/page-watch-datasets';
import { MANUAL_BID_SOURCE } from './manual-bids/flag';

/**
 * City open bids (kind 'contract', data.subtype 'bid'): source ids, the feature flag and the one test for "is this a bid".
 * Pure and client-safe: no server imports, so match.ts, approx-location.ts and the cards can all use it.
 *
 * HOLLER_BIDS_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any case). Off means: the bid adapters do not run (run.ts, and
 * their own fetch returns nothing) and any bid row already stored is never matched (match.ts), so no bid reaches a member's feed,
 * push or digest. The default is off so shipping this code changes nothing until the owner flips the flag.
 */
export const BIDS_FLAG = 'HOLLER_BIDS_ENABLED';
/**
 * The Atlanta-area agency feeds read with Firecrawl spend paid credits, so they have their OWN switch on top of HOLLER_BIDS_ENABLED
 * (round 16 review): turning on the city bids (SF, LA, Baton Rouge, NYC) never starts Firecrawl spend by itself. Default off. All three are
 * needed: HOLLER_BIDS_ENABLED, HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY.
 */
export const LOCAL_BIDS_FLAG = 'HOLLER_LOCAL_BIDS_ENABLED';

/** Every city-bid source id the code knows. A source can be configured here and still be disabled (see city-bids.ts `verified`). */
export const BID_SOURCE_IDS: readonly string[] = [
  'bids-sf',
  'bids-la',
  'bids-batonrouge',
  'bids-nyc',
  // Atlanta-area agency pages read with Firecrawl (lib/firecrawl/local-sources.ts, lib/signals/adapters/bids-local.ts).
  'bids-gwinnett',
  'bids-rockdale',
  'bids-tucker',
  'bids-dunwoody',
  // Round 20 page watch (lib/signals/adapters/page-watch-datasets.ts): public bid pages read with a plain fetch, on probation.
  ...PAGE_WATCH_IDS,
  // Round 33: bids the owner adds by hand from pages Holler does not read (lib/signals/manual-bids). Not an adapter: no scan runs it.
  MANUAL_BID_SOURCE,
];

/** Prefix of every city-bid source id. */
export const BID_SOURCE_PREFIX = 'bids-';

const ON = new Set(['1', 'true', 'on', 'yes']);

/** Reads the flag at call time (not at import), so a test or a redeploy with a new value takes effect without a rebuild of this module. */
export function bidsEnabled(value: string | undefined = process.env[BIDS_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

/** The Firecrawl agency feeds' own switch, same on-values as the bids flag. Read at call time. */
export function localBidsEnabled(value: string | undefined = process.env[LOCAL_BIDS_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

/** True for a stored or fresh signal that is a city bid: data.subtype 'bid' or one of the bid sources. Accepts a feed row, a match row or a SignalInput. */
export function isBidSignal(s: { source?: string | null; subtype?: unknown; data?: { subtype?: unknown } | null } | null | undefined): boolean {
  if (!s) return false;
  const sub = typeof s.subtype === 'string' && s.subtype ? s.subtype : s.data?.subtype;
  if (sub === 'bid') return true;
  return typeof s.source === 'string' && (BID_SOURCE_IDS.includes(s.source) || s.source.startsWith(BID_SOURCE_PREFIX));
}

/** Anything with a source id, as every reader's row has. */
interface BidRowLike {
  source?: string | null;
  subtype?: unknown;
  data?: { subtype?: unknown; dueDate?: unknown } | null;
  /** holler_signals.expires_at: for a bid, the due instant (null when the source publishes no due date). */
  expires_at?: string | null;
  expiresAt?: string | null;
  /** data.dueDate read flat (DEADLINE_SELECT alias): a local calendar day, "2026-12-07". */
  dueDate?: string | null;
}

/** A date-only due day is open until the end of that day in every US time zone (UTC-10 is the latest, so 34 hours after 00:00 UTC). */
const DUE_DAY_GRACE_MS = 34 * 3_600_000;

/**
 * True when a bid's due date has passed (review P2-14): the solicitation is over, so the record is dropped, never shown as
 * "Coming soon ... closed". expires_at is the due instant when the source gives one; a bid with only a due day closes at the end of
 * that day. A bid with no due date at all is not closed (it is kept for 60 days by the adapter's own window). Non-bids are never "closed".
 */
export function bidClosed(s: BidRowLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!s || !isBidSignal(s)) return false;
  const exp = s.expires_at ?? s.expiresAt ?? null;
  if (typeof exp === 'string' && exp) {
    const t = Date.parse(exp);
    if (Number.isFinite(t)) return t <= nowMs;
  }
  const day = s.dueDate ?? s.data?.dueDate;
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}/.test(day)) {
    const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
    if (Number.isFinite(t)) return t + DUE_DAY_GRACE_MS <= nowMs;
  }
  return false;
}

/**
 * True for a federal bid (sam-gov) whose response date has passed (review P2-2): like a closed city bid it is dropped, never shown as
 * "Coming soon". For sam-gov, expires_at is the response date. Not flag-gated (federal bids are not behind HOLLER_BIDS_ENABLED).
 */
export function federalBidClosed(s: BidRowLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!s || s.source !== 'sam-gov') return false;
  const exp = s.expires_at ?? s.expiresAt ?? null;
  if (typeof exp !== 'string' || !exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t <= nowMs;
}

/**
 * True when a record must not be shown right now: a city bid while the flag is off (review P1-3), or a bid whose due date has passed
 * (P2-14). Used where stored matches are read for a member (web feed, mobile feed, email digest, push), so turning the flag off removes
 * bids members already have, and a closed bid leaves at once. A federal bid past its response date leaves too (federalBidClosed). Pass
 * `on` and `nowMs` in tests; by default both are read at call time.
 */
export function bidHidden(s: BidRowLike | null | undefined, on: boolean = bidsEnabled(), nowMs: number = Date.now()): boolean {
  if (!isBidSignal(s)) return federalBidClosed(s, nowMs);
  return !on || bidClosed(s, nowMs);
}

/** The matches whose signal is not a hidden city bid: what a member-facing read keeps. `signal` may be an object, a one-item array or null. */
export function dropHiddenBids<T extends { signal: unknown }>(matches: T[], on: boolean = bidsEnabled(), nowMs: number = Date.now()): T[] {
  return matches.filter((m) => {
    const s = Array.isArray(m.signal) ? m.signal[0] : m.signal;
    return !bidHidden(s as Parameters<typeof bidHidden>[0], on, nowMs);
  });
}

/**
 * The rows minus city bids that must not be shown on a PUBLIC page (/check, city, weekly, trade and /data pages, the area preview):
 * every bid row while the flag is off (review P2-13: rows stored while it was on stay in holler_signals until their due date), and any
 * bid whose due date has passed. Rows of every other source are untouched. Pure; pass `on` and `nowMs` in tests.
 */
export function withoutHiddenBids<T extends BidRowLike>(rows: T[], nowMs: number = Date.now(), on: boolean = bidsEnabled()): T[] {
  return rows.filter((r) => !bidHidden(r, on, nowMs));
}

/**
 * Keeps hidden bids out of a PostgREST count or list query while the flag is off: `source NOT LIKE 'bids-%'`. A query builder from
 * supabase-js has `.not`; anything else (a test double without it) is returned unchanged, and the row filters above still apply.
 */
export function excludeBidsInQuery<Q>(q: Q, on: boolean = bidsEnabled()): Q {
  if (on) return q;
  const b = q as unknown as { not?: (col: string, op: string, v: string) => Q };
  return typeof b.not === 'function' ? b.not('source', 'like', `${BID_SOURCE_PREFIX}%`) : q;
}
