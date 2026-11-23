/**
 * Holler may share a Stripe account (and the Supabase auth users) with other products.
 * Everything Holler creates is tagged metadata.app = 'holler', and everything Holler reads or cancels
 * must carry that tag.
 */
export const APP_TAG = 'holler';

export function hollerMetadata(userId: string): { app: string; user_id: string } {
  return { app: APP_TAG, user_id: userId };
}

export function isHollerMetadata(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.app === APP_TAG;
}

import { TRIAL_MAX_DAYS } from '../auth/membership';

const DAY_MS = 86_400_000;
/** Stripe Checkout requires subscription_data.trial_end to be at least 48 hours out (see Stripe SDK types). */
const MIN_TRIAL_END_MS = 2 * DAY_MS + 5 * 60_000;
/**
 * Never pass Stripe a trial longer than the longest trial Holler ever granted (TRIAL_MAX_DAYS, 60 days): no row can legitimately end
 * later than that, so a later value is bad data and is cut back. This also keeps every trial far inside Stripe's own limit (a trial
 * period must be 730 days or less).
 * Round 23: measured against TRIAL_MAX_DAYS, not TRIAL_DAYS. Cutting at the new 30 days would charge a member still holding a 60-day
 * trial up to a month before their trial ends, which is exactly what "existing trials keep their end date" forbids.
 */
export const MAX_TRIAL_MS = TRIAL_MAX_DAYS * DAY_MS;

export type TrialParams = { trial_end: number } | { trial_period_days: number } | Record<string, never>;

/**
 * Keeps the app-side free trial intact when someone subscribes early: no charge until trial_ends_at.
 * - trial already over: charge now (no trial params)
 * - at least 48 h left: exact trial_end timestamp (a full trial included; more than TRIAL_MAX_DAYS left is cut to now + TRIAL_MAX_DAYS)
 * - less than 48 h left: Checkout rejects trial_end, so use whole trial_period_days (rounded up, minimum 1),
 *   which can only ever add a few free hours, never charge inside the trial.
 */
export function trialParams(trialEndsAt: string | null | undefined, now: number = Date.now()): TrialParams {
  const end = trialEndsAt ? new Date(trialEndsAt).getTime() : NaN;
  if (!Number.isFinite(end)) return {};
  const left = end - now;
  if (left <= 0) return {};
  // A row may legitimately end up to TRIAL_MAX_DAYS plus 5 minutes out (clock skew between the app and the database): that is not cut.
  if (left > MAX_TRIAL_MS + 5 * 60_000) return { trial_end: Math.ceil((now + MAX_TRIAL_MS) / 1000) };
  if (left >= MIN_TRIAL_END_MS) return { trial_end: Math.ceil(end / 1000) };
  return { trial_period_days: Math.max(1, Math.ceil(left / DAY_MS)) };
}

/** Statuses that already have a live Holler subscription. Checkout must not create a second one. */
export function alreadySubscribed(status: string | null | undefined): boolean {
  return status === 'active' || status === 'past_due';
}

/**
 * True only when the request says its body is JSON (media type exactly application/json, parameters allowed). A cross-site HTML
 * form can only send form-encoded or text/plain bodies, and a "text/plain; application/json" header is text/plain, so it fails.
 * State-changing billing routes answer 415 otherwise.
 */
export function isJsonRequest(req: Request): boolean {
  const ct = req.headers.get('content-type') ?? '';
  return ct.split(';')[0].trim().toLowerCase() === 'application/json';
}

export function unsupportedMediaType(): Response {
  return Response.json({ error: 'unsupported_media_type' }, { status: 415 });
}
