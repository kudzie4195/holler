/**
 * Round 35: the switch for the pressure-washing rule set (lib/signals/lead-rules.ts pwRuleOf, pwMemberLabel; caps in lib/signals/pw-caps.ts). HOLLER_PW_RULES_ENABLED is OFF unless "1",
 * "true", "on" or "yes" (any case). Off, a member with House cleaning AND Siding and gutters (the sign-up "Pressure washing" chip,
 * lib/plan/composite-trades.ts) gets exactly what those two trades got before: every label, card, email and replay row is unchanged.
 *
 * The feed card's reason line and the sign-up hint run in the browser too, so the default reads `process.env.HOLLER_PW_RULES_ENABLED` as a
 * plain member expression: next.config.ts inlines it (lib/build-switches.ts INLINED_SWITCHES) and the server and the browser hold the same
 * build value. Outside Next (tests, scripts, the replay) it is the real environment variable. No imports: lead-rules.ts reads it.
 */
export const PW_RULES_FLAG = 'HOLLER_PW_RULES_ENABLED';

export function pwRulesEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env.HOLLER_PW_RULES_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

/** The two trades the "Pressure washing" chip saves (lib/plan/composite-trades.ts PRESSURE_WASHING_PARTS; a test checks they agree). */
export const PW_PARTS: readonly string[] = ['cleaning', 'siding-gutters'];

/** The composite chip's id (lib/plan/composite-trades.ts PRESSURE_WASHING_ID): the trade a card is shown under when the pw rules decide it. */
export const PW_TRADE = 'pressure-washing';

/**
 * A member the pw rules apply to: the switch is on and the member holds BOTH House cleaning and Siding and gutters. The profile form shows
 * exactly that member with the "Pressure washing" chip selected (components/profile-form.tsx pwOn), and the season table already treats
 * them as one (lib/season/table.ts allTrades), so holding both is the chip.
 */
export function isPwMember(trades: readonly string[] | null | undefined, on: boolean = pwRulesEnabled()): boolean {
  return on && Array.isArray(trades) && PW_PARTS.every((p) => trades.includes(p));
}
