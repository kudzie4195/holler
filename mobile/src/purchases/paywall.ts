// What the paywall shows, as a pure function of what is known. The screen only renders this.
import type { EntitlementId, MeResponse, PlanDto } from '../contract';
import { ENTITLEMENT_IDS, TIER_FOR_ENTITLEMENT } from '../contract';
import type { StorePackage } from './purchases';
import { effectiveAccess } from './plan';

export interface PlanOffer {
  entitlement: EntitlementId;
  name: string;
  monthly: StorePackage | null;
  yearly: StorePackage | null;
  limits: PlanDto['limits'] | null;
  /** Free trial days the STORE says this person can still get. Null: show no trial. */
  trialDays: number | null;
}

export type PaywallView =
  | { kind: 'loading' }
  /** A live website (Stripe) plan: never offer a store purchase. */
  | { kind: 'managed-on-web'; tierName: string; manageUrl: string | null }
  /** Paid through the store already. Pro offer present when an upgrade exists. */
  | { kind: 'subscribed'; tierName: string; fromStore: boolean; upgrade: PlanOffer | null }
  /** This build cannot sell (web preview, or no RevenueCat key). */
  | { kind: 'unavailable' }
  /** The store answered with nothing we can sell. */
  | { kind: 'error' }
  | { kind: 'offer'; plans: PlanOffer[] };

export interface PaywallInput {
  me: MeResponse | null;
  plans: Partial<Record<EntitlementId, PlanDto>> | null;
  storeAvailable: boolean;
  /** null while loading. */
  packages: StorePackage[] | null;
  storeEntitlement: EntitlementId | null;
}

function offerFor(entitlement: EntitlementId, input: PaywallInput): PlanOffer | null {
  const pk = (input.packages ?? []).filter((p) => p.entitlement === entitlement);
  const monthly = pk.find((p) => p.period === 'monthly') ?? null;
  const yearly = pk.find((p) => p.period === 'yearly') ?? null;
  if (!monthly && !yearly) return null;
  const plan = input.plans?.[entitlement] ?? null;
  const trials = [monthly?.trial?.days, yearly?.trial?.days].filter((d): d is number => typeof d === 'number' && d > 0);
  return {
    entitlement,
    name: plan?.name ?? (entitlement === 'pro' ? 'Pro' : 'Solo'),
    monthly,
    yearly,
    limits: plan?.limits ?? null,
    trialDays: trials.length ? Math.min(...trials) : null,
  };
}

export function paywallView(input: PaywallInput): PaywallView {
  const access = input.me?.access ?? null;
  const tierName = (tier: 'starter' | 'pro') => input.plans?.[tier === 'pro' ? 'pro' : 'solo']?.name ?? (tier === 'pro' ? 'Pro' : 'Solo');

  // A website plan wins over everything: the member already pays, and the server refuses a second plan.
  if (access && (access.mayBuyInStore === false || (access.state === 'paid' && access.billingSource === 'stripe'))) {
    return { kind: 'managed-on-web', tierName: access.tierName || tierName(access.tier), manageUrl: access.manageUrl };
  }

  const eff = effectiveAccess(access, input.storeEntitlement);
  if (eff.state === 'paid') {
    if (!input.storeAvailable) return { kind: 'subscribed', tierName: tierName(eff.tier), fromStore: eff.fromStore, upgrade: null };
    const upgrade = eff.tier === 'starter' && input.packages ? offerFor('pro', input) : null;
    return { kind: 'subscribed', tierName: tierName(eff.tier), fromStore: eff.fromStore, upgrade };
  }

  if (!input.storeAvailable) return { kind: 'unavailable' };
  if (input.packages === null) return { kind: 'loading' };
  const plans = ENTITLEMENT_IDS.map((id) => offerFor(id, input)).filter((p): p is PlanOffer => p !== null);
  if (!plans.length) return { kind: 'error' };
  return { kind: 'offer', plans };
}

/** "Billed $79.99 a year" style lines, always from the store's own price string. */
export function periodLabel(pkg: StorePackage): string {
  return pkg.period === 'yearly' ? `${pkg.priceString} a year` : `${pkg.priceString} a month`;
}

export function tierOf(entitlement: EntitlementId) {
  return TIER_FOR_ENTITLEMENT[entitlement];
}
