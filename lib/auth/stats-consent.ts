/**
 * Opt-in consent to put a member's alert answers into Holler's combined statistics (round 23, owner decision).
 *
 * Why it exists: every outcome tap collected without it ("useful", "not relevant", "led to work", plus the job amount) can be used to
 * improve the member's own alerts, and nothing else. The privacy page never said the combined figures might be published, shared or
 * sold, and there was no consent step, so taps collected before this shipped cannot become a data asset later. From this deploy the
 * sign-up form carries ONE UNTICKED, OPTIONAL box, and what the member saw is stored with it.
 *
 * Where it is stored: `app_metadata.holler_stats_consent` on the shared auth user, as { version, at } and, after an untick,
 * { version, at, revoked_at }. app_metadata, not holler_profiles, because:
 *   - the box is answered at sign-up, before any profile row exists (the profile is written at onboarding);
 *   - it needs no migration, so it cannot be half-applied in production;
 *   - it follows the person, like holler_trial_started_at and the sign-up language, not the profile row, so deleting the account and
 *     coming back does not silently re-consent.
 * Only the service role can write app_metadata (the member's own JWT cannot), which is what we want for a consent record.
 *
 * `version` is the wording the member agreed to, in the same shape as the waitlist's consent version (lib/waitlist/service.ts). Change
 * the wording, change the version, and the old rows still say what they agreed to. Nothing here reads or writes any tap: this module
 * only records the answer.
 */
export const STATS_CONSENT_KEY = 'holler_stats_consent';

/** The wording version a tick records today. Bump it whenever CONSENT_TEXT or the privacy paragraph changes. */
export const STATS_CONSENT_VERSION = 'v1-2026-11';

/**
 * The box itself, word for word as the owner settled it. The privacy page carries the long form (app/privacy/page.tsx, "Your answers
 * about alerts"). tests/legal keep this string and the page in step.
 */
export const STATS_CONSENT_TEXT =
  "Count my alert taps and job results in Holler's combined statistics. My name, business, email and address are never included. Holler may publish, share or sell these combined statistics. I can turn this off in Settings.";

export interface StatsConsent {
  version: string;
  /** When it was ticked (ISO). */
  at: string;
  /** When it was unticked (ISO), if it was. Set means "not consenting now". */
  revoked_at?: string;
}

/** The stored record, or null when the person never answered the box (which is the same as "no"). */
export function statsConsentOf(appMetadata: unknown): StatsConsent | null {
  const v = (appMetadata as { [STATS_CONSENT_KEY]?: unknown } | null | undefined)?.[STATS_CONSENT_KEY];
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.at !== 'string') return null;
  return { version: r.version, at: r.at, ...(typeof r.revoked_at === 'string' ? { revoked_at: r.revoked_at } : {}) };
}

/** True only when the person has ticked the box and not unticked it since. Absent, malformed or revoked all read as false. */
export function statsConsentGiven(appMetadata: unknown): boolean {
  const c = statsConsentOf(appMetadata);
  return c !== null && !c.revoked_at;
}

/**
 * The app_metadata patch for an answer. Ticking stamps the version and the time; unticking keeps the original tick (so the record still
 * shows what was agreed and when) and adds revoked_at, which is the day we stop adding their answers. Answering "no" at sign-up stores
 * nothing at all: an unticked optional box is not an event worth recording.
 */
export function statsConsentPatch(appMetadata: unknown, consent: boolean, now: Date): Record<string, unknown> | null {
  const current = statsConsentOf(appMetadata);
  if (consent) {
    if (current && !current.revoked_at) return null; // already on: nothing to write
    return { [STATS_CONSENT_KEY]: { version: STATS_CONSENT_VERSION, at: current?.at ?? now.toISOString() } };
  }
  if (!current || current.revoked_at) return null; // already off (or never answered): nothing to write
  return { [STATS_CONSENT_KEY]: { ...current, revoked_at: now.toISOString() } };
}
