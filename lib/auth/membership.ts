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
 * Free trial length in days. THE single source: code, copy, emails, JSON-LD, the mobile payloads and lib/plan/public-prices.ts read it,
 * and lib/plan/price-copy.ts builds every trial phrase from it (TRIAL_HEADLINE, the 2-month headline, and TRIAL_PHRASE, "60-day free trial"). Owner decision (round 18): 60 days
 * (2 months), no card; it was 14 (migration 0019). Migration 0028 sets the database to the same 60, and lib/auth/trial.ts brings a new
 * member's row to start + TRIAL_DAYS even before 0028 is applied, so the site never promises more than the database gives.
 */
export const TRIAL_DAYS = 60;

/** When this person's one free trial started (ISO), recorded in app_metadata so deleting the account cannot reset it. */
export function trialStartedAt(appMetadata: unknown): string | null {
  const at = (appMetadata as { holler_trial_started_at?: unknown } | null | undefined)?.holler_trial_started_at;
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null;
}

/** The only trial end this person can ever have: start + TRIAL_DAYS. */
export function trialEndFromStart(startedAt: string): string {
  return new Date(Date.parse(startedAt) + TRIAL_DAYS * 86_400_000).toISOString();
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
