import 'server-only';
import { hit } from '@/lib/auth/ratelimit';
import { createAdminClient } from '@/lib/supabase/admin';
import { FEATURE_IDS, type FeatureId } from './features';
import type { InterestDeps } from './service';

/** Production wiring for lib/interest/service.ts. Throws the admin client's "not configured" error when Supabase is not set up. */
export function interestDeps(): InterestDeps {
  const db = createAdminClient();
  return {
    db: db as unknown as InterestDeps['db'],
    hit: (limits) => hit(limits, db),
  };
}

/** A member's own picks. Any failure (including a missing table) is an empty list, so the feed renders as before. */
export async function loadMemberPicks(userId: string): Promise<FeatureId[]> {
  try {
    const { data, error } = await createAdminClient().from('holler_feature_interest').select('feature').eq('user_id', userId);
    if (error || !data) return [];
    const got = new Set((data as { feature: string }[]).map((r) => r.feature));
    return FEATURE_IDS.filter((id) => got.has(id));
  } catch {
    return [];
  }
}
