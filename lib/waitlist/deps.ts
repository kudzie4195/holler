import 'server-only';
import { hit } from '@/lib/auth/ratelimit';
import { sendEmail, signScopedToken, verifyScopedToken, renderWaitlistConfirm } from '@/lib/email';
import { env, siteUrl } from '@/lib/env';
import { lookupZip } from '@/lib/geo';
import { createAdminClient } from '@/lib/supabase/admin';
import { WAITLIST_CONFIRM_PURPOSE, WAITLIST_CONFIRM_TTL_SECONDS, type WaitlistDeps } from './service';

const TABLE = 'holler_area_waitlist';

/** Production wiring for lib/waitlist/service.ts. Throws the admin client's "not configured" error when Supabase is not set up. */
export function waitlistDeps(): WaitlistDeps {
  const db = createAdminClient();
  const secret = env.CRON_SECRET ?? '';
  return {
    db: {
      // ignoreDuplicates: a repeat for the same (email, ZIP) keeps the first row (and its confirmed_at) untouched.
      upsert: (row) => db.from(TABLE).upsert(row, { onConflict: 'email,zip', ignoreDuplicates: true }),
      find: (email, zip) =>
        db.from(TABLE).select('id,confirmed_at,unsubscribed_at').eq('email', email).eq('zip', zip).maybeSingle(),
      // Only an unconfirmed row changes, so a second click keeps the first confirmation time.
      confirm: async (id, at) => {
        const upd = await db.from(TABLE).update({ confirmed_at: at }).eq('id', id).is('confirmed_at', null).select('id').maybeSingle();
        if (upd.error || upd.data) return upd;
        // Already confirmed: still a success for the visitor.
        return db.from(TABLE).select('id').eq('id', id).maybeSingle();
      },
    },
    hit: (limits) => hit(limits, db),
    lookupZip: (zip) => {
      const z = lookupZip(zip);
      return z ? { state: z.state, lat: z.lat, lon: z.lon, city: z.city } : null;
    },
    signToken: (id) => signScopedToken(WAITLIST_CONFIRM_PURPOSE, id, secret, WAITLIST_CONFIRM_TTL_SECONDS),
    verifyToken: (token) => verifyScopedToken(token, WAITLIST_CONFIRM_PURPOSE, secret),
    sendConfirm: async ({ to, confirmUrl, place }) => {
      if (!secret) return false;
      const msg = renderWaitlistConfirm({ confirmUrl, place });
      const res = await sendEmail({ to, subject: msg.subject, html: msg.html, text: msg.text });
      if ('ok' in res && res.ok) return true;
      console.error('[waitlist] confirm email not sent');
      return false;
    },
    siteUrl,
    now: () => new Date(),
  };
}
