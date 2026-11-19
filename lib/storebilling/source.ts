/**
 * Who bills a member, and whether one billing source may overwrite another. Pure: no server imports.
 * Same rules as migration 0020 (holler_apply_store_event) on the store side; the Stripe webhook uses stripeMayOverwrite on its side.
 */

export type BillingSource = 'none' | 'stripe' | 'apple' | 'google';

/** The billing fields of a holler_profiles row. Every field is optional so rows read before migration 0020 still work. */
export interface BillingRow {
  plan?: string | null;
  subscription_status?: string | null;
  plan_source?: string | null;
  store_expires_at?: string | null;
  stripe_subscription_id?: string | null;
}

/**
 * A store plan whose expiry is more than this far in the past no longer counts as paid, even if the EXPIRATION webhook never arrived.
 * Apple and Google move the expiry forward on every renewal and through their billing grace periods, so a live plan never trips it.
 */
export const STORE_EXPIRY_GRACE_MS = 3 * 86_400_000;

const isPaid = (s: string | null | undefined) => s === 'active' || s === 'past_due';

export function isStoreSource(s: unknown): s is 'apple' | 'google' {
  return s === 'apple' || s === 'google';
}

/** The stored source, with a pre-0020 row that holds a Stripe subscription read as Stripe. */
export function billingSourceOf(row: BillingRow | null | undefined): BillingSource {
  const s = row?.plan_source;
  if (s === 'stripe' || s === 'apple' || s === 'google') return s;
  return row?.stripe_subscription_id ? 'stripe' : 'none';
}

/** The store plan's expiry in ms, or null when it is missing or cannot be read. */
function storeExpiryMs(row: BillingRow): number | null {
  if (typeof row.store_expires_at !== 'string' || row.store_expires_at.trim() === '') return null;
  const end = Date.parse(row.store_expires_at);
  return Number.isFinite(end) ? end : null;
}

/**
 * True when the store plan's expiry (plus grace) has passed, or when a store row has no readable expiry at all: a store plan is never
 * "paid forever" (review r2 F1). False for a row that is not billed by a store.
 */
export function storePlanLapsed(row: BillingRow | null | undefined, now: number = Date.now()): boolean {
  if (!row || !isStoreSource(row.plan_source)) return false;
  const end = storeExpiryMs(row);
  return end === null || end + STORE_EXPIRY_GRACE_MS < now;
}

function logUnreadableExpiry(row: BillingRow): void {
  if (isStoreSource(row.plan_source) && isPaid(row.subscription_status) && storeExpiryMs(row) === null) {
    console.error('[billing] store plan with no readable expiry treated as not paid; NEEDS A LOOK');
  }
}

/**
 * THE paid test, shared by the feed lock (lib/auth/access.ts computeAccess), web checkout, plan limits (lib/plan effectiveTier), the
 * email digest (lib/email/notify-logic.ts) and the scanner (lib/signals/store.ts canSeeAlerts): status active or past_due, and not a
 * store plan whose expiry is unreadable or more than STORE_EXPIRY_GRACE_MS in the past. Stripe and pre-0020 rows: the status alone.
 */
export function isPaidNow(row: BillingRow | null | undefined, now: number = Date.now()): boolean {
  if (!row || !isPaid(row.subscription_status)) return false;
  if (!isStoreSource(row.plan_source)) return true;
  logUnreadableExpiry(row);
  return !storePlanLapsed(row, now);
}

/** A paid plan billed by the App Store or Google Play whose period has not run out. A missing or unreadable expiry is not live. */
export function isStorePlanLive(row: BillingRow | null | undefined, now: number = Date.now()): boolean {
  if (!row || !isStoreSource(row.plan_source) || !isPaid(row.subscription_status)) return false;
  const end = storeExpiryMs(row);
  if (end === null) {
    logUnreadableExpiry(row);
    return false;
  }
  return end > now;
}

/** A paid plan billed by Stripe (the website). */
export function isStripePlanLive(row: BillingRow | null | undefined): boolean {
  return !!row && isPaid(row.subscription_status) && billingSourceOf(row) === 'stripe';
}

const RANK: Record<string, number> = { starter: 1, pro: 2 };
export function planRank(plan: string | null | undefined): number {
  return RANK[plan ?? ''] ?? 0;
}

/**
 * May a Stripe webhook write `status` and `tier` over this row?
 * Not over a live App Store or Google Play plan, unless Stripe brings a paid plan of a HIGHER rank (Solo on the store, Pro on the web):
 * the member is then paying the web for more, and the web takes over. A Stripe cancel, a Stripe plan of the same or lower rank, or a
 * Stripe event with no tier never touches a live store plan.
 */
export function stripeMayOverwrite(
  row: BillingRow | null | undefined,
  next: { status: string | null; tier?: string | null },
  now: number = Date.now(),
): boolean {
  if (!isStorePlanLive(row, now)) return true;
  if (!isPaid(next.status) || !next.tier) return false;
  return planRank(next.tier) > planRank(row?.plan);
}

/** The two holler_profiles columns migration 0020 adds for store billing. Explicit-column reads append these and retry without them. */
export const STORE_PROFILE_COLUMNS: string = 'plan_source, store_expires_at';

/**
 * True when a read failed only because a 0020 store column is missing (Postgres "column ... does not exist" or PostgREST "Could not
 * find the ... column"). Callers then read again without STORE_PROFILE_COLUMNS: before 0020 no store plan can exist.
 */
export function missingStoreColumn(message: string | null | undefined): boolean {
  const m = message ?? '';
  return /(plan_source|store_expires_at)/.test(m) && /does not exist|could not find/i.test(m);
}
