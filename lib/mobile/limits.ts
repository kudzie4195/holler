import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rateKey, type Limit } from '@/lib/auth/limits';
import { hit, type HitResult } from '@/lib/auth/ratelimit';

/**
 * Rate limits for the mobile API (app/api/m/**). The website's limiter (lib/auth/ratelimit.ts hit, the holler_rate_hit counter), keyed
 * by a keyed hash of the member id or the network address, never the raw value. Reads are generous, writes tight.
 * The counters live in holler_rate_limits, which account deletion does not touch: deleting and onboarding again does not reset them.
 */
export type MemberLimitKind = 'read' | 'write' | 'push' | 'onboarding' | 'delete';

export const MOBILE_LIMITS = {
  /**
   * Requests whose token FAILED (missing, malformed, or refused by the Auth server), per network address (review v2 P2, commander
   * decision 8). Over the cap, such requests get 429 instead of 401. A request with a valid token is never counted here and never
   * refused by it: it is limited per member only, so junk tokens from a shared address (carrier NAT, office Wi-Fi) cannot lock real
   * members out. The key prefix changed from 'm-ip' so old counters do not carry over.
   */
  badToken: (ip: string): Limit => ({ key: rateKey('m-badtok', 'ip', ip), max: 60, windowSeconds: 300 }),
  /** /me, /feed, /alert: about one a second on average. */
  read: (userId: string): Limit => ({ key: rateKey('m-read', 'user', userId), max: 300, windowSeconds: 300 }),
  /** /profile, /feedback. */
  write: (userId: string): Limit => ({ key: rateKey('m-write', 'user', userId), max: 120, windowSeconds: 3600 }),
  /** /push/register (POST and DELETE). */
  push: (userId: string): Limit => ({ key: rateKey('m-push', 'user', userId), max: 20, windowSeconds: 3600 }),
  /** /onboarding (each try counts, also a rejected one). */
  onboarding: (userId: string): Limit => ({ key: rateKey('m-onboard', 'user', userId), max: 10, windowSeconds: 3600 }),
  /** /account/delete. */
  delete: (userId: string): Limit => ({ key: rateKey('m-delete', 'user', userId), max: 5, windowSeconds: 3600 }),
  /** The welcome and confirm email, per address. The per-user cap is the website's LIMITS.verifyResendUser (3 an hour). */
  verifyEmail: (email: string): Limit => ({ key: rateKey('verify', 'email', email), max: 3, windowSeconds: 3600 }),
} as const;

type Admin = Pick<SupabaseClient, 'rpc'>;

/** hit() that never throws: a limiter that cannot run is 'error' (each caller decides fail open or closed). */
export async function safeHit(limits: Limit[], admin: Admin | null): Promise<HitResult> {
  if (!admin) return 'error';
  try {
    return await hit(limits, admin as Parameters<typeof hit>[1]);
  } catch {
    return 'error';
  }
}
