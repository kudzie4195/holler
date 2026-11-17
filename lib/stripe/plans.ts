export type Plan = 'monthly' | 'annual';

export const MONTHLY_PRICE_CENTS = 500;
export const ANNUAL_PRICE_CENTS = 4800;

/** Whole-percent saving of the annual plan against twelve monthly payments: (60 - 48) / 60 = 20. */
export const ANNUAL_SAVINGS_PERCENT = Math.round(((MONTHLY_PRICE_CENTS * 12 - ANNUAL_PRICE_CENTS) / (MONTHLY_PRICE_CENTS * 12)) * 100);

export const PLAN_COPY: Record<Plan, { label: string; price: string; cadence: string }> = {
  monthly: { label: 'Monthly', price: '$5', cadence: 'a month' },
  annual: { label: 'Yearly', price: '$48', cadence: 'a year' },
};

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

/** Inline Stripe price_data for a plan (no pre-made Price object needed). */
export function priceDataFor(plan: Plan): {
  currency: 'usd';
  unit_amount: number;
  recurring: { interval: 'month' | 'year' };
  product_data: { name: string };
} {
  return {
    currency: 'usd',
    unit_amount: plan === 'annual' ? ANNUAL_PRICE_CENTS : MONTHLY_PRICE_CENTS,
    recurring: { interval: plan === 'annual' ? 'year' : 'month' },
    product_data: { name: plan === 'annual' ? 'Holler (yearly)' : 'Holler' },
  };
}
