import { cacheLife } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { BUILDER_WINDOW_DAYS } from './active';
import { loadActiveBuilders, type ActiveBuildersResult } from './load';

/**
 * "Who's building near you", cached (round 19 review, defect 4). The loader reads up to 3,000 nearby permits and their contractor rows,
 * so it must not run on every /app render. Shared remote cache, keyed by the member and the scope that decides the result (the
 * arguments are the cache key): 15 minutes fresh, the same pattern as lib/signals/source-state-snapshot.ts. A failure is an empty
 * result cached for one minute. The page renders the panel in its own Suspense below the feed, never before it, and never for a locked
 * account; the loader re-checks access itself, so a member who loses access sees the panel for at most this cache's life.
 */
export interface BuilderScope {
  categories: string[] | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
  radius_mi: number;
  plan: string | null;
  subscription_status: string | null;
  plan_source: string | null;
  store_expires_at: string | null;
  extra_areas: unknown;
}

/** The fields of a profile the panel depends on, as plain data (the cache key must be serializable and must not hold anything else). */
export function builderScopeOf(p: Partial<BuilderScope> & { radius_mi?: number | null }): BuilderScope {
  return {
    categories: Array.isArray(p.categories) ? [...p.categories] : null,
    lat: typeof p.lat === 'number' ? p.lat : null,
    lon: typeof p.lon === 'number' ? p.lon : null,
    state: typeof p.state === 'string' ? p.state : null,
    radius_mi: Number(p.radius_mi) || 0,
    plan: typeof p.plan === 'string' ? p.plan : null,
    subscription_status: typeof p.subscription_status === 'string' ? p.subscription_status : null,
    plan_source: typeof p.plan_source === 'string' ? p.plan_source : null,
    store_expires_at: typeof p.store_expires_at === 'string' ? p.store_expires_at : null,
    extra_areas: p.extra_areas === undefined ? null : JSON.parse(JSON.stringify(p.extra_areas ?? null)),
  };
}

export async function cachedActiveBuilders(userId: string, scope: BuilderScope): Promise<ActiveBuildersResult> {
  'use cache: remote';
  try {
    const res = await loadActiveBuilders(createAdminClient(), userId, scope, new Date());
    cacheLife({ stale: 300, revalidate: 900, expire: 1800 });
    return res;
  } catch {
    cacheLife({ stale: 30, revalidate: 60, expire: 120 });
    return { builders: [], windowDays: BUILDER_WINDOW_DAYS };
  }
}
