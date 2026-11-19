import 'server-only';
import { clientIp } from '@/lib/auth/limits';
import { hit } from '@/lib/auth/ratelimit';
import { siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { IngestDeps } from './ingest';

/** Production wiring for lib/analytics/ingest.ts. Throws the admin client's "not configured" error when Supabase is not set up. */
export function ingestDeps(): IngestDeps {
  const db = createAdminClient();
  return {
    hit: (limits) => hit(limits, db),
    insert: async (row) => {
      const { error } = await db.from('holler_events').insert(row);
      // Duplicates (one visit per session per day) and a missing table are quiet. Nothing here may fail the beacon.
      if (error && error.code !== '23505' && error.code !== '42P01') console.error('[analytics] beacon insert failed', error.code ?? 'unknown');
    },
    siteUrl,
    ip: clientIp,
  };
}
