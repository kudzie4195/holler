import { createHash, createHmac } from 'node:crypto';
import { REQUEST_CONFIRM_DAILY_CAP } from '@/lib/requests/constants';
/** First entry of x-forwarded-for (the client as seen by the edge), else x-real-ip, else 'unknown'. */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = request.headers.get('x-real-ip')?.trim();
  return real ? real.slice(0, 64) : 'unknown';
}

/**
 * The one hashing helper for rate-limit keys (and the resident-request email key). HMAC-SHA256 keyed with the server secret
 * (CRON_SECRET, read at call time), so a stored key cannot be reversed by hashing every IPv4 address or a list of emails.
 * Only when no secret is configured (local tests, a dev box) does it fall back to a plain sha256, as before.
 * The value is lower-cased first, so "A@B.com" and "a@b.com" share a key. 128 bits of hex.
 */
export function rateDigest(value: string, secret: string | undefined = process.env.CRON_SECRET): string {
  const v = value.toLowerCase();
  const h = secret ? createHmac('sha256', secret).update(`holler-rate:v1:${v}`) : createHash('sha256').update(v);
  return h.digest('hex').slice(0, 32);
}

/** Keys never hold raw emails or IPs; the table is service-only but still a place PII should not sit. */
export function rateKey(scope: string, kind: 'ip' | 'email' | 'user', value: string): string {
  return `${scope}:${kind}:${rateDigest(value)}`;
}

export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  signupIp: (ip: string): Limit => ({ key: rateKey('signup', 'ip', ip), max: 5, windowSeconds: 3600 }),
  signupEmail: (email: string): Limit => ({ key: rateKey('signup', 'email', email), max: 3, windowSeconds: 86_400 }),
  forgotEmail: (email: string): Limit => ({ key: rateKey('forgot', 'email', email), max: 3, windowSeconds: 3600 }),
  forgotIp: (ip: string): Limit => ({ key: rateKey('forgot', 'ip', ip), max: 10, windowSeconds: 3600 }),
  loginIp: (ip: string): Limit => ({ key: rateKey('login', 'ip', ip), max: 20, windowSeconds: 900 }),
  draftUser: (userId: string): Limit => ({ key: rateKey('draft', 'user', userId), max: 20, windowSeconds: 3600 }),
  verifyResendUser: (userId: string): Limit => ({ key: rateKey('verify', 'user', userId), max: 3, windowSeconds: 3600 }),
  /** Resident requests (/request): new requests per IP per hour. Over the limit the visitor is told to wait. */
  requestIp: (ip: string): Limit => ({ key: rateKey('request', 'ip', ip), max: 5, windowSeconds: 3600 }),
  /**
   * Confirm emails per address per day. Pass a keyed hash of the address (lib/requests/tokens.ts emailRateValue), never the address.
   * Over the limit the request is dropped silently, so the answer never shows whether an address was used before.
   */
  requestEmail: (emailKey: string): Limit => ({ key: rateKey('request', 'email', emailKey), max: 3, windowSeconds: 86_400 }),
  /** Confirmation emails to residents, site-wide, per day. Over it the form answers "not taking new requests right now". */
  requestConfirmGlobal: (): Limit => ({ key: 'request:global:confirm', max: REQUEST_CONFIRM_DAILY_CAP, windowSeconds: 86_400 }),
  /** Reply attempts per business per hour (the 10 replies a day cap itself is counted in holler_request_replies). */
  requestReplyUser: (userId: string): Limit => ({ key: rateKey('reply', 'user', userId), max: 30, windowSeconds: 3600 }),
  /** Plan switches (POST /api/stripe/change-plan) per member per hour. Each real switch creates a Stripe price and invoice lines. */
  planChangeUser: (userId: string): Limit => ({ key: rateKey('plan-change', 'user', userId), max: 6, windowSeconds: 3600 }),
  /** Checkout starts (POST /api/stripe/checkout) per member per hour. Each one creates a Stripe Checkout Session (review P2-4d). */
  checkoutUser: (userId: string): Limit => ({ key: rateKey('checkout', 'user', userId), max: 10, windowSeconds: 3600 }),
  /** Billing portal opens (POST /api/stripe/portal) per member per hour. Each one creates a Stripe portal session (review P2-4d). */
  portalUser: (userId: string): Limit => ({ key: rateKey('portal', 'user', userId), max: 20, windowSeconds: 3600 }),
  /** "Coming next" picks (POST /api/interest): per IP per hour for a signed-out visitor. Same keyed-hash counter as the request form. */
  interestIp: (ip: string): Limit => ({ key: rateKey('interest', 'ip', ip), max: 20, windowSeconds: 3600 }),
  /** "Coming next" picks per signed-in member per hour. */
  interestUser: (userId: string): Limit => ({ key: rateKey('interest', 'user', userId), max: 20, windowSeconds: 3600 }),
  /** "Coming to your area" waitlist (POST /api/waitlist): per IP per hour. Same keyed-hash counter as the interest form. */
  waitlistIp: (ip: string): Limit => ({ key: rateKey('waitlist', 'ip', ip), max: 10, windowSeconds: 3600 }),
  /** Waitlist signups per email address per day. Pass the address; only a keyed hash is stored. */
  // 3 a day: every accepted sign-up sends one confirmation email (double opt-in), so one mailbox is never flooded (round 19 review).
  waitlistEmail: (email: string): Limit => ({ key: rateKey('waitlist', 'email', email), max: 3, windowSeconds: 86_400 }),
} as const;

export const RATE_LIMIT_MESSAGE = 'Too many tries. Wait a bit, then try again.';
