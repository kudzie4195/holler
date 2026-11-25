/**
 * Round 33: the switch for new-business licence handling (lib/signals/mapping/business.ts). Off unless "1", "true", "on" or "yes" (any case).
 * Read at call time; a client bundle (where the value is undefined) always sees it off. No imports: lead-rules.ts and alert-gate.ts read it.
 */
export const BUSINESS_TAG_FIX_FLAG = 'HOLLER_BUSINESS_TAG_FIX_ENABLED';

export function businessTagFixEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_BUSINESS_TAG_FIX_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}
