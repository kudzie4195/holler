import { cacheLife } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSourceStates } from './source-state-load';

/**
 * The state of every source, for the member screens (the /check results and the app feed header). Server only.
 * holler_source_health is service-role only, so this reads it with the admin client and returns ONLY the state, its reason code and the
 * newest record date per source (the "last update" a member is told): no error text, no counts. Shared remote cache, 5 minutes fresh. A failed read returns null and is
 * cached for a minute: the screens then show no notice (they do not know), which is why the owner's health email also reports states.
 */
export interface SourceStateSnapshot {
  generatedAt: string;
  states: Record<string, { state: string; reason: string; lastRecordAt: string | null }>;
}

export async function loadSourceStateSnapshot(): Promise<SourceStateSnapshot | null> {
  'use cache: remote';
  const now = new Date();
  try {
    const results = await loadSourceStates(createAdminClient(), now);
    cacheLife({ stale: 60, revalidate: 300, expire: 900 });
    return {
      generatedAt: now.toISOString(),
      states: Object.fromEntries(results.map((r) => [r.id, { state: r.state, reason: r.reason, lastRecordAt: r.lastRecordAt }])),
    };
  } catch {
    cacheLife({ stale: 30, revalidate: 60, expire: 120 });
    return null;
  }
}
