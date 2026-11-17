import Stripe from 'stripe';
import { env } from '../env';
import { MONTHLY_PRICE_CENTS } from './plans';

export * from './status';
export * from './scope';
export * from './plans';
export * from './products';

let cached: Stripe | null = null;

/** Returns null when STRIPE_SECRET_KEY is not set. */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!cached) cached = new Stripe(env.STRIPE_SECRET_KEY);
  return cached;
}

export function billingNotConfigured(): Response {
  return Response.json({ error: 'billing_not_configured' }, { status: 503 });
}

/** Starter monthly price in cents. Kept for existing imports; prices live in ./plans (PRICES_CENTS). */
export const PRICE_CENTS = MONTHLY_PRICE_CENTS;
