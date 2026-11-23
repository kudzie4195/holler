/**
 * Opt-in consent to put a member's alert answers into Holler's combined statistics (round 23, owner decision).
 *
 * Why it exists: every outcome tap collected without it ("useful", "not relevant", "led to work", plus the job amount) can be used to
 * improve the member's own alerts, and nothing else. The privacy page never said the combined figures might be published, shared or
 * sold, and there was no consent step, so taps collected before this shipped cannot become a data asset later. From this deploy the
 * sign-up form carries ONE UNTICKED, OPTIONAL box, and what the member saw is stored with it.
 *
 * Where it is stored: `app_metadata.holler_stats_consent` on the shared auth user, as { version, at } and, after an untick,
 * { version, at, revoked_at }. Round 24: a re-tick moves the closed period into `history` and starts a new { version, at }; deleting the
 * Holler account withdraws consent (lib/auth/membership.ts leaveHollerPatch adds revoked_at). app_metadata, not holler_profiles, because:
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

/** One earlier period of consent, kept when the box is ticked again (round 24, review P2-4). */
export interface StatsConsentPeriod {
  version: string;
  at: string;
  revoked_at?: string;
}

export interface StatsConsent {
  version: string;
  /** When it was ticked (ISO). */
  at: string;
  /** When it was unticked (ISO), if it was. Set means "not consenting now". */
  revoked_at?: string;
  /**
   * Round 24 (review P2-4): earlier periods, oldest first. A re-tick moves the closed period here and starts a new one with today's date
   * and today's wording version, so the record always shows when the member was NOT consenting.
   */
  history?: StatsConsentPeriod[];
}

function periodOf(v: unknown): StatsConsentPeriod | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.at !== 'string') return null;
  return { version: r.version, at: r.at, ...(typeof r.revoked_at === 'string' ? { revoked_at: r.revoked_at } : {}) };
}

/** The stored record, or null when the person never answered the box (which is the same as "no"). */
export function statsConsentOf(appMetadata: unknown): StatsConsent | null {
  const v = (appMetadata as { [STATS_CONSENT_KEY]?: unknown } | null | undefined)?.[STATS_CONSENT_KEY];
  const cur = periodOf(v);
  if (!cur) return null;
  const raw = (v as { history?: unknown }).history;
  const history = Array.isArray(raw) ? raw.map(periodOf).filter((p): p is StatsConsentPeriod => p !== null) : [];
  return history.length ? { ...cur, history } : cur;
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
    if (!current) return { [STATS_CONSENT_KEY]: { version: STATS_CONSENT_VERSION, at: now.toISOString() } };
    // Round 24 (review P2-4): a re-tick keeps the closed period in `history` and starts a new one today, with today's wording.
    const closed: StatsConsentPeriod = { version: current.version, at: current.at, ...(current.revoked_at ? { revoked_at: current.revoked_at } : {}) };
    return { [STATS_CONSENT_KEY]: { version: STATS_CONSENT_VERSION, at: now.toISOString(), history: [...(current.history ?? []), closed] } };
  }
  if (!current || current.revoked_at) return null; // already off (or never answered): nothing to write
  return { [STATS_CONSENT_KEY]: { ...current, revoked_at: now.toISOString() } };
}
