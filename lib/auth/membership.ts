/**
 * Holler shares auth.users with other products, so "has a Holler account" is explicit:
 * app_metadata.products contains 'holler' (set at signup), or a holler_profiles row exists (legacy accounts).
 */
export const PRODUCT = 'holler';

export function productsOf(appMetadata: unknown): string[] {
  const products = (appMetadata as { products?: unknown } | null | undefined)?.products;
  return Array.isArray(products) ? products.filter((p): p is string => typeof p === 'string') : [];
}

export function hasHollerTag(appMetadata: unknown): boolean {
  return productsOf(appMetadata).includes(PRODUCT);
}

export function withoutHoller(appMetadata: unknown): string[] {
  return productsOf(appMetadata).filter((p) => p !== PRODUCT);
}

export function withHoller(appMetadata: unknown): string[] {
  const p = productsOf(appMetadata);
  return p.includes(PRODUCT) ? p : [...p, PRODUCT];
}

/** Set when someone deletes their Holler account. The shared sign-in is never deleted, so they may come back. */
export function hasLeftHoller(appMetadata: unknown): boolean {
  const at = (appMetadata as { holler_left_at?: unknown } | null | undefined)?.holler_left_at;
  return typeof at === 'string' && at.length > 0;
}

/**
 * Free trial length in days for a NEW trial. THE single source: code, copy, emails, JSON-LD, the mobile payloads and
 * lib/plan/public-prices.ts read it, and lib/plan/price-copy.ts builds every trial phrase from it (TRIAL_HEADLINE, the 1-month headline,
 * and TRIAL_PHRASE, "30-day free trial"). Owner decision (round 23, launch): 30 days, no card; it was 60 (migration 0028) and 14 before
 * that (migration 0019). Migration 0038 sets the database default, the one-trial cap and the member-insert guard to the same 30 days, and
 * lib/auth/trial.ts brings a new member's row to start + TRIAL_DAYS, so the site never promises more than the database gives.
 */
export const TRIAL_DAYS = 30;

/**
 * The longest trial any person may hold: the length of the longest trial Holler ever granted (60 days, migration 0028). It is NOT
 * advertised anywhere and no new trial is ever set to it. It exists so that moving TRIAL_DAYS down can never shorten a trial somebody
 * already holds (owner decision, round 23: "every existing trial keeps its current end date"):
 *   - a row that ends at or before start + TRIAL_MAX_DAYS is left exactly as it is, so a running 60-day trial keeps its day;
 *   - only a row beyond that cap (which no Holler code ever wrote) is cut back, and then to the cap, never to start + TRIAL_DAYS.
 * Drop it, and the cap branch in lib/auth/trial.ts with it, once no profile can still hold a trial longer than TRIAL_DAYS: that is
 * TRIAL_MAX_DAYS after the round 23 deploy (so from late January 2027), when every 60-day trial has ended.
 */
export const TRIAL_MAX_DAYS = 60;

/** When this person's one free trial started (ISO), recorded in app_metadata so deleting the account cannot reset it. */
export function trialStartedAt(appMetadata: unknown): string | null {
  const at = (appMetadata as { holler_trial_started_at?: unknown } | null | undefined)?.holler_trial_started_at;
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null;
}

/** The end a NEW trial gets: start + TRIAL_DAYS. Also the target a short never-paid row is moved out to. */
export function trialEndFromStart(startedAt: string): string {
  return new Date(Date.parse(startedAt) + TRIAL_DAYS * 86_400_000).toISOString();
}

/**
 * The latest end a trial may hold: start + TRIAL_MAX_DAYS. A stored end at or under this is never touched (so a 60-day trial granted
 * before round 23 keeps its day); only an end beyond it is cut back, and only to here.
 */
export function trialCapFromStart(startedAt: string): string {
  return new Date(Date.parse(startedAt) + TRIAL_MAX_DAYS * 86_400_000).toISOString();
}

/**
 * app_metadata patch applied when a user deletes their Holler account. Keeps every other product's tags.
 * Also stamps the trial start (from the profile being deleted) when no stamp exists yet, so an account that predates the stamp
 * cannot delete and re-onboard for a second trial.
 */
export function leaveHollerPatch(appMetadata: unknown, now: Date, profileCreatedAt?: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { products: withoutHoller(appMetadata), holler_email_verified_at: null, holler_left_at: now.toISOString() };
  if (!trialStartedAt(appMetadata) && profileCreatedAt && Number.isFinite(Date.parse(profileCreatedAt))) patch.holler_trial_started_at = profileCreatedAt;
  return patch;
}

/** app_metadata patch applied when a former member logs in again. */
export function rejoinHollerPatch(appMetadata: unknown): Record<string, unknown> {
  return { products: withHoller(appMetadata), holler_left_at: null };
}
