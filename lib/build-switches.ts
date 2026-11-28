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
 * next.config.ts passes the whole `env` block through normalizeSwitchEnv, so ANY entry (one added by another change too) is inlined as the
 * parsed answer, and a name that is not an on/off switch stops the build. `npm run build` then runs scripts/check-client-switches.mjs,
 * which fails the build if a browser chunk still reads a server variable at runtime, or if a server bundle or a source file still reads an
 * inlined name in a form Next does not replace (`process.env?.NAME`). The check takes the inlined names from THIS list (INLINED_SWITCHES
 * below, read as text), not from .next/required-server-files.json: on Vercel Next writes no `env` into that manifest, so a rule that
 * depended on it never ran there. Add a switch to the list and the check covers it on every build, Vercel included.
 *
 * Which names normalizeSwitchEnv accepts: every HOLLER_<WORDS>_ENABLED, and the five older on/off switches in OTHER_SWITCHES below, by name
 * (never "any name"). They are read by different rules, so each is inlined by ITS rule (see SwitchReading).
 */
export const INLINED_SWITCHES = ['HOLLER_SAM_LABELS_ENABLED', 'HOLLER_BUSINESS_TAG_FIX_ENABLED', 'HOLLER_ROAD_WORDS_ENABLED'] as const;

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

/**
 * How a server reader turns the variable into on or off. The inlined text must give the browser reader the same answer:
 *  - 'on-words': off unless 1, true, on or yes (switchOn). Inlined "1" or "".
 *  - 'default-on': ON unless 0, false, off or no, so an unset variable is ON. Inlined "1" (on) or "0" (off), never "". A reader that
 *    got "" for an off switch would turn it on again; that is why these are not folded into the on-words rule.
 *  - 'one': on only when it is exactly "1" after trim (REVENUECAT_ALLOW_SANDBOX). Inlined "1" or "".
 *  - 'one-raw': on only when it is exactly "1", no trim (HOLLER_PREVIEW_FIXTURES). Inlined "1" or "".
 */
export type SwitchReading = 'on-words' | 'default-on' | 'one' | 'one-raw';

/**
 * The on/off switches whose names are not HOLLER_<WORDS>_ENABLED. Nothing else may be inlined; add a name here only with its reading.
 * Accepting a name here inlines nothing by itself: only INLINED_SWITCHES (above) goes into next.config.ts `env`, and none of these five is
 * listed there today. tests/ops/client-switches.test.ts holds each mapping to the real reader named in the comment (same answer for the raw
 * text and for the inlined text, on every input), so a change to either side fails a test.
 * Before listing one of them in INLINED_SWITCHES, know that three readers (lookupSettings, previewFixturesEnabled, sandboxGrantsAllowed) take
 * `process.env` whole as a parameter. Next replaces only a literal `process.env.NAME`, so for those three the server would keep reading the
 * real variable at runtime and only a browser reader would see the inlined value. That is harmless on Vercel, where a deployment's runtime
 * variables are the variables it was built with, but it means listing them would change nothing the server reads.
 */
export const OTHER_SWITCHES: Readonly<Record<string, SwitchReading>> = {
  REQUESTS_ENABLED: 'default-on', // lib/requests/enabled.ts requestsEnabled
  HOLLER_PROBATION_FETCH: 'default-on', // lib/signals/probation-fetch.ts probationFetchOn
  HOLLER_LOOKUP_DRY_RUN: 'on-words', // lib/enrich/business-lookup.ts lookupSettings
  HOLLER_PREVIEW_FIXTURES: 'one-raw', // lib/seo/home-live.ts previewFixturesEnabled
  REVENUECAT_ALLOW_SANDBOX: 'one', // lib/storebilling/revenuecat.ts
};

/** An on/off switch name: HOLLER_<WORDS>_ENABLED, or one of OTHER_SWITCHES. Nothing else may be inlined into the bundles. */
export const SWITCH_NAME = /^HOLLER_[A-Z0-9_]+_ENABLED$/;

export function isSwitchName(name: string): boolean {
  return SWITCH_NAME.test(name) || Object.prototype.hasOwnProperty.call(OTHER_SWITCHES, name);
}

function readingOf(name: string): SwitchReading {
  return Object.prototype.hasOwnProperty.call(OTHER_SWITCHES, name) ? OTHER_SWITCHES[name] : 'on-words';
}

/** The value inlined for one switch under its reading ("1", "0" or ""), never the raw text. */
export function inlinedSwitchValue(name: string, raw: string | undefined | null): '1' | '0' | '' {
  const text = typeof raw === 'string' ? raw : '';
  switch (readingOf(name)) {
    case 'default-on':
      return /^\s*(?:0|false|off|no)\s*$/i.test(text) ? '0' : '1';
    case 'one':
      return text.trim() === '1' ? '1' : '';
    case 'one-raw':
      return text === '1' ? '1' : '';
    default:
      return switchOn(text) ? '1' : '';
  }
}

/**
 * The final `env` block: every entry as the parsed answer ("1" or "", or "0" for a default-on switch), never the raw text. Throws on a name
 * that is not an on/off switch, so a key or a secret can never be inlined into a browser bundle through next.config.ts.
 */
export function normalizeSwitchEnv(env: Record<string, string | undefined> | undefined): Record<string, '1' | '0' | ''> {
  const out: Record<string, '1' | '0' | ''> = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    if (!isSwitchName(name)) throw new Error(`next.config.ts env: ${name} is not an on/off switch (HOLLER_..._ENABLED or one listed in lib/build-switches.ts OTHER_SWITCHES); only switches may be inlined.`);
    out[name] = inlinedSwitchValue(name, value);
  }
  return out;
}
