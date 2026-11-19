/**
 * What each paid plan allows. Pure (no server imports), so the form, the save, the matcher and the tests share one copy.
 * The database enforces the same numbers (migration 0004, trigger holler_profiles_plan_limits).
 */
// Relative path: the mobile app build loads this file (tests/plan/public-prices.test.ts).
import { isPaidNow } from '../storebilling/source';

export type Tier = 'starter' | 'pro';
export const TIERS: readonly Tier[] = ['starter', 'pro'] as const;

export interface PlanLimits {
  /** Service areas in total: the main ZIP plus extra ZIPs. */
  areas: number;
  /** Extra ZIPs on top of the main one. */
  extraAreas: number;
  trades: number;
  keywords: number;
}

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  starter: { areas: 1, extraAreas: 0, trades: 5, keywords: 0 },
  pro: { areas: 3, extraAreas: 2, trades: 15, keywords: 5 },
};

/** The most any plan allows. Used as the absolute cap before plan rules apply. */
export const MAX_TRADES = Math.max(...TIERS.map((t) => PLAN_LIMITS[t].trades));
export const MAX_EXTRA_AREAS = Math.max(...TIERS.map((t) => PLAN_LIMITS[t].extraAreas));
export const MAX_KEYWORDS = Math.max(...TIERS.map((t) => PLAN_LIMITS[t].keywords));

export const KEYWORD_MIN_LENGTH = 3;
export const KEYWORD_MAX_LENGTH = 40;

/**
 * Display names. The internal id `starter` stays everywhere (code, database, Stripe metadata and product id); only the name shown to
 * people is "Solo". Read names from here, never type them.
 */
export const TIER_NAMES: Record<Tier, string> = { starter: 'Solo', pro: 'Pro' };

export function isTier(x: unknown): x is Tier {
  return x === 'starter' || x === 'pro';
}

/** Statuses that hold a paid plan (past_due is Stripe's retry window). Same rule as lib/auth/access.ts. */
export function isPaidStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'past_due';
}

/**
 * The plan whose limits apply right now.
 * - Pro only while the stored plan is 'pro' AND the plan is paid now (lib/storebilling/source.ts isPaidNow: active or past_due, and
 *   not a store plan that has lapsed or has no readable expiry). Pass the whole profile row so the store columns (migration 0020) count.
 * - The free trial, a canceled subscription and an expired trial all get Solo (`starter`) limits. Saved extras stay saved; they are just not used.
 * - When the caller passes no status at all (undefined), the stored plan alone decides. null or any other status means not paid.
 * The database trigger in migration 0004 applies the same rule on the status, and 0020 (holler_profiles_plan_limits_store) adds the
 * lapsed store plan test, with the same 3-day grace.
 */
export function effectiveTier(
  p: { plan?: string | null; subscription_status?: string | null; plan_source?: string | null; store_expires_at?: string | null } | null | undefined,
  now: number = Date.now(),
): Tier {
  if (!p || p.plan !== 'pro') return 'starter';
  if (p.subscription_status === undefined) return 'pro';
  return isPaidNow(p, now) ? 'pro' : 'starter';
}
