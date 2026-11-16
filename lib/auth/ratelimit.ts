import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Limit } from './limits';

type Admin = ReturnType<typeof createAdminClient>;

export { clientIp, LIMITS, RATE_LIMIT_MESSAGE } from './limits';

export type HitResult = 'allowed' | 'limited' | 'error';

/**
 * Counts one hit against each limit, in order, and stops at the first one that is exceeded.
 * 'error' means the limiter itself failed (for example the migration is not applied); callers choose fail-open or fail-closed.
 * Throws the admin client's "not configured" error so routes can answer 503.
 */
export async function hit(limits: Limit[], admin: Admin = createAdminClient()): Promise<HitResult> {
  for (const l of limits) {
    const { data, error } = await admin.rpc('holler_rate_hit', {
      p_key: l.key,
      p_max: l.max,
      p_window_seconds: l.windowSeconds,
    });
    if (error || typeof data !== 'boolean') {
      console.error('[ratelimit] holler_rate_hit failed', error?.code ?? 'bad_result');
      return 'error';
    }
    if (!data) return 'limited';
  }
  return 'allowed';
}

