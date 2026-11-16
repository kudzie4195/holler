import Stripe from 'stripe';
import { env } from '../env';

export * from './status';
export * from './scope';

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

export const PRICE_CENTS = 500;
