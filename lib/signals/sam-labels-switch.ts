/**
 * Round 33 review fix: the switch for the SAM.gov notice labels (set-aside line, early-notice line, sole-source routing, the mobile intent
 * line, the email's closing line for a bid with a set-aside). HOLLER_SAM_LABELS_ENABLED is OFF unless "1", "true", "on" or "yes" (any
 * case). Off, every card, email and app answer is byte-identical to what it was before round 33 (tests/signals/sam-labels-switch.test.ts).
 * Reading it at call time keeps it out of the client bundle's constants; the labels are all computed on the server.
 */
export const SAM_LABELS_FLAG = 'HOLLER_SAM_LABELS_ENABLED';

export function samLabelsEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_SAM_LABELS_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

/** The six documented sole-source set-aside codes: the agency names the one business it means to buy from, so the notice is not open for offers. */
const SOLE_SOURCE_CODES: ReadonlySet<string> = new Set(['8AN', 'HZS', 'SDVOSBS', 'WOSBSS', 'EDWOSBSS', 'VSS']);

/** True for a stored set-aside code (data.setAside) that is a sole source. Case does not matter. */
export function isSoleSourceSetAside(stored: unknown): boolean {
  return typeof stored === 'string' && SOLE_SOURCE_CODES.has(stored.trim().toUpperCase());
}
