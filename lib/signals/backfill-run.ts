import { rateKey, type Limit } from '@/lib/auth/limits';
import type { BackfillResult } from './backfill';

/** At most this many backfills per user per hour: each is a service-role read of up to 1000 rows plus up to 25 inserts. */
export const BACKFILL_RATE = { max: 6, windowSeconds: 3600 } as const;

export function backfillLimit(userId: string): Limit {
  return { key: rateKey('backfill', 'user', userId), ...BACKFILL_RATE };
}

export interface BackfillDeps {
  hit?: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
  run?: (userId: string) => Promise<BackfillResult>;
}

export type BackfillOutcome = { ran: true; result: BackfillResult } | { ran: false; reason: 'limited' | 'error' };

/**
 * Rate-limited backfill for one user. Never throws.
 * A limiter failure (for example the rate-limit migration is not applied) lets the backfill run: it is bounded (one read, at most 25
 * inserts) and the hit() call already logs the failure. Only an explicit 'limited' answer skips it.
 */
export async function backfillWithLimit(userId: string, deps: BackfillDeps = {}): Promise<BackfillOutcome> {
  try {
    const hit = deps.hit ?? (async (l: Limit[]) => (await import('@/lib/auth/ratelimit')).hit(l));
    const verdict = await hit([backfillLimit(userId)]).catch(() => 'error' as const);
    if (verdict === 'limited') return { ran: false, reason: 'limited' };
    const run =
      deps.run ??
      (async (id: string) => {
        const [{ backfillForUser }, { createAdminClient }] = await Promise.all([import('./backfill'), import('@/lib/supabase/admin')]);
        return backfillForUser(createAdminClient(), id);
      });
    return { ran: true, result: await run(userId) };
  } catch (e) {
    console.error('backfillWithLimit failed:', e instanceof Error ? e.message : String(e));
    return { ran: false, reason: 'error' };
  }
}
