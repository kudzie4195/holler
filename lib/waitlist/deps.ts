import 'server-only';
import { hit } from '@/lib/auth/ratelimit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WaitlistDeps } from './service';

/** Production wiring for lib/waitlist/service.ts. Throws the admin client's "not configured" error when Supabase is not set up. */
export function waitlistDeps(): WaitlistDeps {
  const db = createAdminClient();
  return {
    db: db as unknown as WaitlistDeps['db'],
    hit: (limits) => hit(limits, db),
  };
}
