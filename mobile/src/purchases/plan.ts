// Plan rules as pure functions: no plugin, no network.
import type { AccessDto, EntitlementId, PlanTier } from '../contract';
import { ENTITLEMENT_IDS, MOBILE_APP_ID, TIER_FOR_ENTITLEMENT } from '../contract';

export type Period = 'monthly' | 'yearly';

/** Only products of this app count. */
export const PRODUCT_PREFIX = `${MOBILE_APP_ID}.`;

/**
 * Which entitlement a store product id grants. Google Play reports `productId:basePlanId`
 * (com.localholler.app.pro.monthly:monthly), so everything after the colon is dropped first. Only ids
 * that start with `com.localholler.app.` count, and the plan is the first segment after that prefix,
 * so "com.other.app.pro.monthly" or "x.solo" grants nothing.
 */
export function productIdToEntitlement(productId: unknown): EntitlementId | null {
  const id = typeof productId === 'string' ? productId.trim().toLowerCase().split(':')[0] : '';
  if (!id.startsWith(PRODUCT_PREFIX)) return null;
  const plan = id.slice(PRODUCT_PREFIX.length).split('.')[0];
  if (plan === 'pro') return 'pro';
  if (plan === 'solo') return 'solo';
  return null;
}

/** monthly / yearly from a product id's last segment, Play suffix removed. */
export function productIdToPeriod(productId: unknown): Period | null {
  const id = typeof productId === 'string' ? productId.trim().toLowerCase().split(':')[0] : '';
  if (id.endsWith('.monthly')) return 'monthly';
  if (id.endsWith('.yearly') || id.endsWith('.annual')) return 'yearly';
  return null;
}

const RANK: Record<EntitlementId, number> = { solo: 1, pro: 2 };

/** The best active entitlement in a RevenueCat CustomerInfo, or null. Never throws. */
export function activeEntitlement(customerInfo: unknown): EntitlementId | null {
  const active = (customerInfo as { entitlements?: { active?: Record<string, { isActive?: boolean } | undefined> } } | null)
    ?.entitlements?.active;
  if (!active || typeof active !== 'object') return null;
  let best: EntitlementId | null = null;
  for (const id of ENTITLEMENT_IDS) {
    const e = active[id];
    if (e && e.isActive !== false && (!best || RANK[id] > RANK[best])) best = id;
  }
  return best;
}

export interface EffectiveAccess {
  state: AccessDto['state'];
  tier: PlanTier;
  /** True when the store says "paid" before the server has heard about it. */
  fromStore: boolean;
}

const TIER_RANK: Record<PlanTier, number> = { starter: 1, pro: 2 };

/**
 * The UI unlocks from the better of the server plan and the store entitlement, so a purchase shows
 * at once even when the RevenueCat webhook lands a few seconds later. It never unlocks anything the
 * server enforces: the server still masks a locked member's feed until the webhook arrives.
 */
export function effectiveAccess(server: Pick<AccessDto, 'state' | 'tier'> | null, store: EntitlementId | null): EffectiveAccess {
  const base: EffectiveAccess = server ? { state: server.state, tier: server.tier, fromStore: false } : { state: 'locked', tier: 'starter', fromStore: false };
  if (!store) return base;
  const storeTier = TIER_FOR_ENTITLEMENT[store];
  if (base.state !== 'paid') return { state: 'paid', tier: storeTier, fromStore: true };
  return TIER_RANK[storeTier] > TIER_RANK[base.tier] ? { state: 'paid', tier: storeTier, fromStore: true } : base;
}

/** A store entitlement remembered together with the member it was read for. */
export interface TaggedEntitlement {
  userId: string;
  entitlement: EntitlementId | null;
}

/** The store entitlement for the signed-in member only. One read for another account never unlocks this one. */
export function entitlementFor(tagged: TaggedEntitlement | null, userId: string | null | undefined): EntitlementId | null {
  if (!tagged || !userId || tagged.userId !== userId) return null;
  return tagged.entitlement;
}
