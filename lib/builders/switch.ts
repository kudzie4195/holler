/**
 * Round 19 integration: the switch for "Who's building near you" on /app.
 *
 * HOLLER_BUILDERS_PANEL_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any case). With it off the panel is not rendered and its
 * loader is never called (no read at all). Why it ships dark: under the round 18 contractor business-name rule the panel shows 48 of the
 * 60 realistic contractor and large-builder names of the round 19 review (tests/builders/names-60.test.ts), below the bar of 54 the
 * integration set; the rule is not loosened for it because it would let private persons through. LAUNCH.md (NEEDS KUDZI) has the numbers.
 *
 * Pure: reads process.env at call time.
 */
export const BUILDERS_PANEL_FLAG = 'HOLLER_BUILDERS_PANEL_ENABLED';

export function buildersPanelEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_BUILDERS_PANEL_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}
