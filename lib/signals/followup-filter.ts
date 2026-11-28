import { bidHidden, bidsEnabled, erateEnabled, erateHidden, isBidSignal } from './bid-sources';
import { holdOf } from './alert-gate';

/**
 * Round 35: follow-up emails (the lifecycle welcome, trial-ending and recap mail, and the outcome follow-up) list stored matches. Before
 * this switch they read no bid switch, no hold and no retirement, so a bid source switched off (HOLLER_BIDS_ENABLED, or HOLLER_ERATE_ENABLED
 * for an E-Rate row), a hand-added bid the owner retired, and a feed-only (held) permit or licence could still be named in an email even though
 * the feed and the alert email already hid them.
 *
 * HOLLER_FOLLOWUP_FILTER_ENABLED is OFF unless "1", "true", "on" or "yes" (any case). Off, every query and every email of those two crons
 * is exactly what it was. On, a match is left out of the list (and its count) when:
 *   - retired     the owner retired the hand-added bid (data.retiredAt is set);
 *   - bid_hidden  the feed's own test says so (bidHidden: bid sources off, E-Rate off, due date or response date passed);
 *   - held        the match carries an alert hold (holler_matches.alert_hold: below the member's minimum, held trade family, or no contact path),
 *                 the same rule the alert email and the push use. Held matches stay in the feed; they are not alerts, so a recap never names them.
 * The outcome follow-up asks about a bid the member marked useful, usually after it closed, so it keeps a bid whose date has passed
 * (`keepClosed`) and drops only the switched-off and retired ones.
 *
 * Server only. Never import this from a component: it reads the switch from the environment at call time.
 */
export const FOLLOWUP_FILTER_FLAG = 'HOLLER_FOLLOWUP_FILTER_ENABLED';

const ON = new Set(['1', 'true', 'on', 'yes']);

/** Read at call time, so a redeploy with a new value (or a test) takes effect without a rebuild of this module. */
export function followupFilterEnabled(value: string | undefined = process.env[FOLLOWUP_FILTER_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

/**
 * The columns the filter reads from holler_signals, as PostgREST select text (it needs data->>subtype too, which both callers already have):
 * the due instant, the due day and the retirement stamp. Added to a select only while the switch is on.
 */
export const FOLLOWUP_SIGNAL_SELECT = 'expires_at, dueDate:data->>dueDate, retiredAt:data->>retiredAt';

export type FollowupDrop = 'retired' | 'bid_hidden' | 'held';

/** A signal as the two follow-up readers select it. */
export interface FollowupSignal {
  source?: string | null;
  subtype?: string | null;
  expires_at?: string | null;
  dueDate?: string | null;
  /** data.retiredAt, selected as text. */
  retiredAt?: string | null;
}

export interface FollowupOptions {
  nowMs?: number;
  /** Keep a bid whose due date has passed (the outcome follow-up). Retired and switched-off bids are still dropped. */
  keepClosed?: boolean;
  /** Test hooks; by default the switches are read at call time. */
  bidsOn?: boolean;
  erateOn?: boolean;
}

/** Why this match must not be named in a follow-up email, or null when it may be. `match` is the holler_matches row (for alert_hold), `signal` its record. */
export function followupDrop(signal: FollowupSignal | null | undefined, match: { alert_hold?: unknown } | null | undefined, opts: FollowupOptions = {}): FollowupDrop | null {
  if (!signal) return null;
  if (typeof signal.retiredAt === 'string' && signal.retiredAt.trim() !== '') return 'retired';
  const nowMs = opts.nowMs ?? Date.now();
  const bidsOn = opts.bidsOn ?? bidsEnabled();
  const erateOn = opts.erateOn ?? erateEnabled();
  const hidden = opts.keepClosed ? isBidSignal(signal) && (!bidsOn || erateHidden(signal, erateOn)) : bidHidden(signal, bidsOn, nowMs, erateOn);
  if (hidden) return 'bid_hidden';
  if (match && holdOf(match)) return 'held';
  return null;
}
