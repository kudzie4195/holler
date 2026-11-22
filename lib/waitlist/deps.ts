import 'server-only';
import { hit } from '@/lib/auth/ratelimit';
import { renderWaitlistConfirm } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email';
import { signScopedToken } from '@/lib/email/token';
import { env, siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { WAITLIST_CONFIRM_TTL_SECONDS, WAITLIST_TABLE, type WaitlistDeps } from './service';
import { WAITLIST_CONFIRM_PURPOSE } from './zip-confirm';

/**
 * Production wiring for lib/waitlist/service.ts (restored from the other branch's lib/waitlist/deps.ts in round 19, review defect 1).
 * Throws the admin client's "not configured" error when Supabase is not set up; the route answers 503.
 */
export function waitlistDeps(): WaitlistDeps {
  const db = createAdminClient();
  const secret = env.CRON_SECRET ?? '';
  return {
    db: {
      // ignoreDuplicates: a repeat for the same (email, ZIP) keeps the first row (and its confirmed_at) untouched.
      upsert: (row) => db.from(WAITLIST_TABLE).upsert(row, { onConflict: 'email,zip', ignoreDuplicates: true }),
      find: (email, zip) => db.from(WAITLIST_TABLE).select('id,confirmed_at,unsubscribed_at').eq('email', email).eq('zip', zip).maybeSingle(),
    },
    hit: (limits) => hit(limits, db),
    signToken: (id) => signScopedToken(WAITLIST_CONFIRM_PURPOSE, id, secret, WAITLIST_CONFIRM_TTL_SECONDS),
    sendConfirm: async ({ to, confirmUrl, place }) => {
      // Without the signing secret no link could be verified: send nothing, the card says "try again later".
      if (!secret) return false;
      const msg = renderWaitlistConfirm({ confirmUrl, place });
      const res = await sendEmail({ to, subject: msg.subject, html: msg.html, text: msg.text });
      return 'ok' in res && res.ok === true;
    },
    siteUrl,
  };
}
