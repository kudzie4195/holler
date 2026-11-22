/**
 * Round 18 (NAMES, redo 1): the switch for owner companies on code-violation cards.
 *
 * HOLLER_VIOLATION_OWNERS_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any case). With it off, nothing about owners is read
 * (extract.ts skips every role 'owner' column), stored (store.ts drops role 'owner' rows) or shown (lib/outreach/loader.ts drops them
 * before any card is built). The two owner columns it reads (Chicago `property_owner`, Austin `owner_name`) are NOT verified on the live
 * portals, and naming an owner beside a code violation is the owner's call to turn on.
 *
 * Pure and client-safe: reads process.env at call time, so a client bundle (where the value is undefined) always sees it off.
 */
export const VIOLATION_OWNERS_FLAG = 'HOLLER_VIOLATION_OWNERS_ENABLED';

export function violationOwnersEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_VIOLATION_OWNERS_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}
