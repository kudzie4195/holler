/**
 * Round 34 switch audit: the feature switches that code running in the BROWSER reads.
 *
 * A variable without NEXT_PUBLIC_ is undefined in the browser. The feed card (components/feed/brief-block.tsx, a client component) builds
 * its "Why it matters" text in the server render AND again in the browser, through lib/signals/brief.ts reasonCopyFor -> lead-rules.ts,
 * which reads the two switches below. Read at runtime, the server saw the owner's value and the browser saw nothing: with a switch on, the
 * two renders disagreed (hydration mismatch, a reason line that flips back).
 *
 * next.config.ts lists every name here under `env`, so Next replaces `process.env.<NAME>` with the build's value in the server and the
 * browser bundle alike. The readers (lib/signals/sam-labels-switch.ts, lib/signals/mapping/business-flag.ts) read it as a plain member
 * expression (no `?.`, no `process.env[name]`), which is the only form Next replaces. Consequence: a change reaches the next deployment
 * only (as for every variable on Vercel), and an instant rollback restores the value that build was made with (LAUNCH.md).
 *
 * Only on/off switches belong here, never a key or a secret: inlinedSwitchEnv inlines "1" or "" (the parsed answer), never the raw text.
 * scripts/check-client-switches.ts fails a build whose browser chunks still read any ENV_KEYS name at runtime.
 */
export const INLINED_SWITCHES = ['HOLLER_SAM_LABELS_ENABLED', 'HOLLER_BUSINESS_TAG_FIX_ENABLED'] as const;

export type InlinedSwitch = (typeof INLINED_SWITCHES)[number];

/** The one on/off reading every Holler switch uses: "1", "true", "on" or "yes" (any case, spaces ignored) is on; anything else is off. */
export function switchOn(value: string | undefined | null): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

/** The `env` block for next.config.ts: each switch as "1" (on) or "" (off), from the build's environment. */
export function inlinedSwitchEnv(source: Record<string, string | undefined> = process.env): Record<InlinedSwitch, '1' | ''> {
  const out = {} as Record<InlinedSwitch, '1' | ''>;
  for (const name of INLINED_SWITCHES) out[name] = switchOn(source[name]) ? '1' : '';
  return out;
}
