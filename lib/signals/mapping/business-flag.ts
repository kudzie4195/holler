/**
 * Round 33: the switch for new-business licence handling (lib/signals/mapping/business.ts). Off unless "1", "true", "on" or "yes" (any case).
 * No imports: lead-rules.ts and alert-gate.ts read it. Round 34 switch audit: lead-rules.ts storefrontKindOfName runs in the browser too (the
 * feed card's reason line), so the default reads `process.env.HOLLER_BUSINESS_TAG_FIX_ENABLED` as a plain member expression: next.config.ts
 * inlines it (lib/build-switches.ts) and the server and the browser hold the same build value. Outside Next it is the real variable.
 */
export const BUSINESS_TAG_FIX_FLAG = 'HOLLER_BUSINESS_TAG_FIX_ENABLED';

export function businessTagFixEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env.HOLLER_BUSINESS_TAG_FIX_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}
