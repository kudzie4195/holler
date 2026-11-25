/**
 * Round 33: bids the owner adds by hand (lib/signals/manual-bids). Pure and client-safe.
 *
 * HOLLER_MANUAL_BIDS_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any case). Off means the owner pages under /app/owner/bids
 * answer 404 and every server action refuses before it reads anything. It is read at call time, so a redeploy with a new value is enough.
 *
 * A record added here is a normal bid row (source MANUAL_BID_SOURCE, kind 'contract', data.subtype 'bid'), so it is ALSO behind
 * HOLLER_BIDS_ENABLED like every bid: with that switch off the owner can preview but not publish (lib/signals/manual-bids/service.ts).
 */
export const MANUAL_BIDS_FLAG = 'HOLLER_MANUAL_BIDS_ENABLED';

/** The signal source of every hand-added bid. Starts with "bids-" so every bid rule, flag and filter applies to it. */
export const MANUAL_BID_SOURCE = 'bids-manual';

const ON = new Set(['1', 'true', 'on', 'yes']);

export function manualBidsEnabled(value: string | undefined = process.env[MANUAL_BIDS_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}
