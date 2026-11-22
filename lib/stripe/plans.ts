// Relative imports only: lib/plan/public-prices.ts (read by the mobile app and the store listings) imports this file, and that
// build may not have the '@/' alias.
import { isTier, TIER_NAMES, type Tier } from '../plan/limits';

export type { Tier } from '../plan/limits';

/** Billing interval. Named Plan for the existing checkout contract ({plan: 'monthly' | 'annual'}). */
export type Plan = 'monthly' | 'annual';

/**
 * THE price list, in cents. Every price shown anywhere (pricing cards, settings, the /pricing page, JSON-LD, SEO copy, llms.txt,
 * lib/plan/public-prices.ts for the apps) is derived from this table through formatUsd or is tested against it
 * (tests/plan/pricing.test.ts, tests/plan/no-old-prices.test.ts).
 * The key `starter` is the internal plan id (database, Stripe metadata, product id); its display name is TIER_NAMES.starter ("Solo").
 * A change here reaches new checkouts and member-initiated plan switches only. Existing subscription items keep the amount they were
 * created with: nothing in this repo re-prices them (tests/money/grandfathering.test.ts).
 */
export const PRICES_CENTS: Record<Tier, Record<Plan, number>> = {
  starter: { monthly: 799, annual: 7999 },
  pro: { monthly: 1399, annual: 13999 },
};

/** Solo (id `starter`) prices, kept under their old names for existing imports. */
export const MONTHLY_PRICE_CENTS = PRICES_CENTS.starter.monthly;
export const ANNUAL_PRICE_CENTS = PRICES_CENTS.starter.annual;

export function priceCents(tier: Tier, plan: Plan): number {
  return PRICES_CENTS[tier][plan];
}

/**
 * Whole-percent saving of the yearly price against twelve monthly payments, computed from PRICES_CENTS and rounded DOWN
 * (Solo and Pro both save 16.6%, shown as 16). Integer math, so no float edge cases. 0 when a price is missing or the yearly price is not lower.
 */
export function annualSavingsPercent(tier: Tier): number {
  const m = (PRICES_CENTS[tier]?.monthly ?? 0) * 12;
  const y = PRICES_CENTS[tier]?.annual ?? 0;
  if (!(m > 0) || !(y > 0) || y >= m) return 0;
  return Math.floor(((m - y) * 100) / m);
}

/** Solo's saving, kept for existing imports. */
export const ANNUAL_SAVINGS_PERCENT = annualSavingsPercent('starter');

/** Cents saved by paying yearly instead of twelve monthly payments. */
export function annualSavingsCents(tier: Tier): number {
  return PRICES_CENTS[tier].monthly * 12 - PRICES_CENTS[tier].annual;
}

/**
 * THE annual saving phrase: "save 16%", computed from the cents and rounded down. Holler's only free offer is the 14-day trial,
 * so the yearly saving is only ever stated as a percent. Empty string when the saving is under 1% or a price is missing.
 */
export function annualSavingLabel(tier: Tier): string {
  const pct = annualSavingsPercent(tier);
  return pct >= 1 ? `save ${pct}%` : '';
}

/** One sentence for next to a plan: "Paying yearly saves 16%." (computed). Empty string when there is no saving to state. */
export function annualSavingSentence(tier: Tier): string {
  const pct = annualSavingsPercent(tier);
  return pct >= 1 ? `Paying yearly saves ${pct}%.` : '';
}

/** "$7.99", "$79.99", "$13.99", "$139.99": whole dollars drop the cents ("$10"). */
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

/** Plain decimal string for schema.org Offer.price ("13.99", "139.99"). */
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

/** Tier carried in Stripe metadata (internal id). Absent or unknown means starter, so subscriptions made before Pro existed keep working. */
export function tierFromMetadata(metadata: Record<string, string> | null | undefined): Tier {
  return metadata?.tier === 'pro' ? 'pro' : 'starter';
}

/**
 * Stripe product ids Holler uses for checkout and plan switches. Prefixed so they cannot collide with another product on the shared
 * account. These ids are the lookup key (lib/stripe/products.ts ensureProduct), so they never change when a display name does:
 * the Solo plan keeps the product id `holler_starter`.
 */
export const PRODUCT_IDS: Record<Tier, string> = { starter: 'holler_starter', pro: 'holler_pro' };

/** Product name shown on Stripe Checkout, invoices and the billing portal: "Holler Solo", "Holler Pro". */
export function productName(tier: Tier): string {
  return `Holler ${TIER_NAMES[tier]}`;
}

/**
 * Inline Stripe Checkout price_data for a plan. No pre-made Price object is needed: Stripe makes a one-off price from these fields.
 * The product is Holler's fixed product for the tier (ensureProduct), never product_data, because product_data makes a new Stripe
 * product on every checkout (stripe@23 Checkout.SessionCreateParams.LineItem.PriceData: "One of product or product_data").
 */
export function priceDataFor(
  plan: Plan,
  tier: Tier,
  productId: string,
): {
  currency: 'usd';
  product: string;
  unit_amount: number;
  recurring: { interval: 'month' | 'year' };
} {
  return {
    currency: 'usd',
    product: productId,
    unit_amount: priceCents(tier, plan),
    recurring: { interval: plan === 'annual' ? 'year' : 'month' },
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
 * A plan switch is an upgrade when the tier goes up or the price goes up (Solo to Pro, monthly to yearly, Pro monthly to
 * Solo yearly). An upgrade is charged at once; anything else is a downgrade, which leaves a credit for the next bill.
 * `from.cents` is what the member pays now (the subscription item's unit_amount). A member who signed up at an older price is
 * compared on that amount, not on today's table; without it the table price is used.
 */
export function isUpgrade(from: { tier: Tier; plan: Plan; cents?: number | null }, to: { tier: Tier; plan: Plan }): boolean {
  const fromCents = typeof from.cents === 'number' && Number.isFinite(from.cents) ? from.cents : priceCents(from.tier, from.plan);
  return TIER_RANK[to.tier] > TIER_RANK[from.tier] || priceCents(to.tier, to.plan) > fromCents;
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
