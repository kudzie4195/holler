import 'server-only';
import { verifyScopedToken } from '@/lib/email/token';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { WAITLIST_CONFIRM_PURPOSE, ZIP_WAITLIST_TABLE, type ZipConfirmDeps } from './zip-confirm';

/** Production wiring for confirmWaitlist (lib/waitlist/zip-confirm.ts). Throws the admin client's "not configured" error when Supabase is not set up. */
export function zipWaitlistConfirmDeps(): ZipConfirmDeps {
  const db = createAdminClient();
  const secret = env.CRON_SECRET ?? '';
  return {
    db: {
      // Only an unconfirmed row changes, so a second click keeps the first confirmation time.
      confirm: async (id, at) => {
        const upd = await db.from(ZIP_WAITLIST_TABLE).update({ confirmed_at: at }).eq('id', id).is('confirmed_at', null).select('id').maybeSingle();
        if (upd.error || upd.data) return upd;
        // Already confirmed: still a success for the visitor.
        return db.from(ZIP_WAITLIST_TABLE).select('id').eq('id', id).maybeSingle();
      },
    },
    verifyToken: (token) => (secret ? verifyScopedToken(token, WAITLIST_CONFIRM_PURPOSE, secret) : null),
    now: () => new Date(),
  };
}
