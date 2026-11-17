import { isTier, TIER_NAMES, type Tier } from '@/lib/plan/limits';

export type { Tier } from '@/lib/plan/limits';

/** Billing interval. Named Plan for the existing checkout contract ({plan: 'monthly' | 'annual'}). */
export type Plan = 'monthly' | 'annual';

/**
 * THE price list, in cents. Every price shown anywhere (pricing cards, settings, the /pricing page, JSON-LD) is derived from this
 * table through formatUsd or is tested against it (tests/plan/pricing.test.ts).
 */
export const PRICES_CENTS: Record<Tier, Record<Plan, number>> = {
  starter: { monthly: 500, annual: 4800 },
  pro: { monthly: 999, annual: 9600 },
};

/** Starter prices, kept under their old names for existing imports. */
export const MONTHLY_PRICE_CENTS = PRICES_CENTS.starter.monthly;
export const ANNUAL_PRICE_CENTS = PRICES_CENTS.starter.annual;

export function priceCents(tier: Tier, plan: Plan): number {
  return PRICES_CENTS[tier][plan];
}

/** Whole-percent saving of the yearly price against twelve monthly payments. Starter: (60 - 48) / 60 = 20. Pro: (119.88 - 96) / 119.88 = 20. */
export function annualSavingsPercent(tier: Tier): number {
  const m = PRICES_CENTS[tier].monthly * 12;
  return Math.round(((m - PRICES_CENTS[tier].annual) / m) * 100);
}

/** Starter's saving, kept for existing imports. */
export const ANNUAL_SAVINGS_PERCENT = annualSavingsPercent('starter');

/** "$5", "$9.99", "$48", "$96": whole dollars drop the cents. */
export function formatUsd(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, '0')}`;
}

/** Display price for a tier and interval, from the table above. */
export function priceLabel(tier: Tier, plan: Plan): string {
  return formatUsd(priceCents(tier, plan));
}

/**
 * The auto-renewal disclosure shown next to every subscribe button (legal.md (a), merged into one sentence). Amounts come from
 * PRICES_CENTS, so the sentence can never disagree with what checkout charges. `inTrial`: the app trial has time left, so checkout
 * starts the subscription with that trial (lib/stripe/scope.ts trialParams) and the first charge comes when it ends.
 */
export function renewalNote(tier: Tier, plan: Plan, opts: { inTrial: boolean }): string {
  const per = plan === 'annual' ? 'year' : 'month';
  const when = opts.inTrial ? 'after your free trial ends' : 'starting today';
  return `${priceLabel(tier, plan)} per ${per} ${when}, and it renews automatically until you cancel in Settings.`;
}

/**
 * The same disclosure next to a plan switch button. The interval stays as it is (change-plan keeps it), and Stripe prorates the
 * difference, so both prices of the new plan are named.
 */
export function planChangeNote(tier: Tier): string {
  return `${TIER_NAMES[tier]} is ${priceLabel(tier, 'monthly')} per month or ${priceLabel(tier, 'annual')} per year on your current billing period, and it renews automatically until you cancel in Settings.`;
}

/** Plain decimal string for schema.org Offer.price ("9.99", "96.00"). */
export function priceDecimal(tier: Tier, plan: Plan): string {
  return (priceCents(tier, plan) / 100).toFixed(2);
}

export const PLAN_COPY: Record<Plan, { label: string; price: string; cadence: string }> = {
  monthly: { label: 'Monthly', price: priceLabel('starter', 'monthly'), cadence: 'a month' },
  annual: { label: 'Yearly', price: priceLabel('starter', 'annual'), cadence: 'a year' },
};

export const TIER_LABEL = TIER_NAMES;

/**
 * Reads the plan out of a checkout request body.
 * Missing body, missing field or null means monthly. A value that is not 'monthly' or 'annual' is rejected (null),
 * so a typo can never silently pick a price.
 */
export function parsePlan(body: unknown): Plan | null {
  if (body === undefined || body === null) return 'monthly';
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const plan = (body as { plan?: unknown }).plan;
  if (plan === undefined || plan === null) return 'monthly';
  return plan === 'monthly' || plan === 'annual' ? plan : null;
}

/**
 * Reads the tier out of a checkout request body. Missing body, missing field or null means starter (the plan that existed
 * before Pro). Anything other than 'starter' or 'pro' is rejected (null), never guessed.
 */
export function parseTier(body: unknown): Tier | null {
  if (body === undefined || body === null) return 'starter';
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const tier = (body as { tier?: unknown }).tier;
  if (tier === undefined || tier === null) return 'starter';
  return isTier(tier) ? tier : null;
}

/**
 * Reads {tier, plan} for a plan switch. tier is required ('starter' | 'pro'). plan is optional ('monthly' | 'annual'):
 * missing keeps the subscription's current interval, read from Stripe (not guessed). Anything else is rejected (null).
 */
export function parseChangeBody(body: unknown): { tier: Tier; plan: Plan | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { tier, plan } = body as { tier?: unknown; plan?: unknown };
  if (!isTier(tier)) return null;
  if (plan === undefined || plan === null) return { tier, plan: null };
  if (plan !== 'monthly' && plan !== 'annual') return null;
  return { tier, plan };
}

/** Tier carried in Stripe metadata. Absent or unknown means starter, so subscriptions made before Pro existed keep working. */
export function tierFromMetadata(metadata: Record<string, string> | null | undefined): Tier {
  return metadata?.tier === 'pro' ? 'pro' : 'starter';
}

/** Stripe product ids Holler creates for plan switches. Prefixed so they cannot collide with another product on the shared account. */
export const PRODUCT_IDS: Record<Tier, string> = { starter: 'holler_starter', pro: 'holler_pro' };

function productName(tier: Tier, plan: Plan): string {
  const base = tier === 'pro' ? 'Holler Pro' : 'Holler';
  return plan === 'annual' ? `${base} (yearly)` : base;
}

/** Inline Stripe Checkout price_data for a plan (no pre-made Price object needed). Tier defaults to starter. */
export function priceDataFor(
  plan: Plan,
  tier: Tier = 'starter',
): {
  currency: 'usd';
  unit_amount: number;
  recurring: { interval: 'month' | 'year' };
  product_data: { name: string };
} {
  return {
    currency: 'usd',
    unit_amount: priceCents(tier, plan),
    recurring: { interval: plan === 'annual' ? 'year' : 'month' },
    product_data: { name: productName(tier, plan) },
  };
}

/**
 * Inline price_data for a subscription item update (stripe.subscriptions.update items[].price_data). In stripe@23 that shape is
 * SubscriptionUpdateParams.Item.PriceData: {currency, product (an id, required), recurring: {interval}, unit_amount}; it has no
 * product_data, so the product comes from ensureProduct().
 */
export function subscriptionPriceData(
  tier: Tier,
  plan: Plan,
  productId: string,
): { currency: 'usd'; product: string; unit_amount: number; recurring: { interval: 'month' | 'year' } } {
  return {
    currency: 'usd',
    product: productId,
    unit_amount: priceCents(tier, plan),
    recurring: { interval: plan === 'annual' ? 'year' : 'month' },
  };
}

/** Billing interval of a Stripe price ('year' means annual, anything else monthly). */
export function planFromInterval(interval: string | null | undefined): Plan {
  return interval === 'year' ? 'annual' : 'monthly';
}

const TIER_RANK: Record<Tier, number> = { starter: 0, pro: 1 };

/**
 * A plan switch is an upgrade when the tier goes up or the price goes up (Starter to Pro, monthly to yearly, Pro monthly to
 * Starter yearly). An upgrade is charged at once; anything else is a downgrade, which leaves a credit for the next bill.
 */
export function isUpgrade(from: { tier: Tier; plan: Plan }, to: { tier: Tier; plan: Plan }): boolean {
  return TIER_RANK[to.tier] > TIER_RANK[from.tier] || priceCents(to.tier, to.plan) > priceCents(from.tier, from.plan);
}

/**
 * Proration arguments for stripe.subscriptions.update (stripe@23 SubscriptionUpdateParams.ProrationBehavior / PaymentBehavior).
 * - Upgrade: 'always_invoice' invoices the prorated difference immediately and charges the saved card; 'error_if_incomplete' makes
 *   Stripe answer 402 and leave the subscription unchanged when that payment fails, so nobody holds Pro on an unpaid difference.
 * - Downgrade: 'create_prorations' leaves the unused time as a credit on the next invoice. Nothing is owed, so nothing can go unbilled.
 */
export function prorationFor(upgrade: boolean):
  | { proration_behavior: 'always_invoice'; payment_behavior: 'error_if_incomplete' }
  | { proration_behavior: 'create_prorations' } {
  return upgrade ? { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' } : { proration_behavior: 'create_prorations' };
}

/** Length of the window in which a repeated plan switch reuses the same Stripe idempotency key. */
export const PLAN_CHANGE_KEY_WINDOW_MS = 60_000;

/**
 * Stripe idempotency key for one plan switch: the same member, subscription, current item and price, target tier and interval,
 * within the same minute. A double click sends one update (Stripe replays the first answer to the second). After a switch the
 * item's price id changes, so the next real switch gets a new key; after a failed card the member can retry a minute later.
 */
export function planChangeKey(
  a: { userId: string; subscriptionId: string; itemId: string; priceId: string | null | undefined; tier: Tier; plan: Plan },
  nowMs: number = Date.now(),
): string {
  const window = Math.floor(nowMs / PLAN_CHANGE_KEY_WINDOW_MS);
  return `holler-change-${a.userId}-${a.subscriptionId}-${a.itemId}-${a.priceId ?? 'none'}-${a.tier}-${a.plan}-${window}`;
}
