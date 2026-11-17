import 'server-only';
import { env, siteUrl } from '@/lib/env';
import { hit } from '@/lib/auth/ratelimit';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestsEnabled } from './enabled';
import { sendRequestEmail } from './mailer';
import type { RequestDeps } from './service';
import { isRequestTrade } from './trades';

/** Production wiring for lib/requests/service.ts. Throws the admin client's "not configured" error when Supabase is not set up. */
export function requestDeps(): RequestDeps {
  const db = createAdminClient();
  return {
    db,
    send: sendRequestEmail,
    hit: (limits) => hit(limits, db),
    secret: env.CRON_SECRET,
    siteUrl,
    adminEmail: env.ADMIN_EMAIL?.trim() || env.SUPPORT_EMAIL?.trim() || null,
    isTrade: (id) => isRequestTrade(id),
    enabled: requestsEnabled(),
  };
}
