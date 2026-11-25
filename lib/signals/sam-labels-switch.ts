/**
 * Round 33 review fix: the switch for the SAM.gov notice labels (set-aside line, early-notice line, sole-source routing, the mobile intent
 * line, the email's closing line for a bid with a set-aside). HOLLER_SAM_LABELS_ENABLED is OFF unless "1", "true", "on" or "yes" (any
 * case). Off, every card, email and app answer is byte-identical to what it was before round 33 (tests/signals/sam-labels-switch.test.ts).
 * Round 34 switch audit: the feed card's reason line runs in the browser too (lead-rules.ts notYetBid via brief.ts reasonCopyFor), so the
 * default reads `process.env.HOLLER_SAM_LABELS_ENABLED` as a plain member expression: next.config.ts inlines it (lib/build-switches.ts) and
 * the server and the browser hold the same build value. Outside Next (tests, scripts, the replay) it is the real environment variable.
 */
export const SAM_LABELS_FLAG = 'HOLLER_SAM_LABELS_ENABLED';

export function samLabelsEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env.HOLLER_SAM_LABELS_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

/** The six documented sole-source set-aside codes: the agency names the one business it means to buy from, so the notice is not open for offers. */
const SOLE_SOURCE_CODES: ReadonlySet<string> = new Set(['8AN', 'HZS', 'SDVOSBS', 'WOSBSS', 'EDWOSBSS', 'VSS']);

/** True for a stored set-aside code (data.setAside) that is a sole source. Case does not matter. */
export function isSoleSourceSetAside(stored: unknown): boolean {
  return typeof stored === 'string' && SOLE_SOURCE_CODES.has(stored.trim().toUpperCase());
}
