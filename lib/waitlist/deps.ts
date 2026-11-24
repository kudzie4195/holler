import 'server-only';
import { hit } from '@/lib/auth/ratelimit';
import { renderWaitlistAlready, renderWaitlistConfirm } from '@/lib/email/templates';
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
      // ignoreDuplicates: a repeat for the same key keeps the first row (and its confirmed_at) untouched. Round 24 FIX2 (review D8): the
      // key is (email, ZIP, trade) after migration 0039; before it the service retries with (email, ZIP).
      upsert: (row, onConflict = 'email,zip') => db.from(WAITLIST_TABLE).upsert(row, { onConflict, ignoreDuplicates: true }),
      find: (email, zip, trade) => {
        const q = db.from(WAITLIST_TABLE).select('id,confirmed_at,unsubscribed_at,trade').eq('email', email).eq('zip', zip);
        return (trade === undefined ? q : trade === null ? q.is('trade', null) : q.eq('trade', trade)).maybeSingle();
      },
    },
    hit: (limits) => hit(limits, db),
    signToken: (id) => signScopedToken(WAITLIST_CONFIRM_PURPOSE, id, secret, WAITLIST_CONFIRM_TTL_SECONDS),
    sendConfirm: async ({ to, confirmUrl, place, trade, lang }) => {
      // Without the signing secret no link could be verified: send nothing, the card says "try again later".
      if (!secret) return false;
      // Round 24: a sign-up for one trade in a place Holler already serves names that trade in the email (lib/email/templates.ts).
      // Round 24 INT2: a sign-up on /es/check gets the Spanish email (lang is set only for Spanish).
      const msg = renderWaitlistConfirm({ confirmUrl, place, trade: trade ?? null, ...(lang === 'es' ? { lang } : {}) });
      const res = await sendEmail({ to, subject: msg.subject, html: msg.html, text: msg.text });
      return 'ok' in res && res.ok === true;
    },
    sendAlready: async ({ to, place, storedTrade, newTrade, confirmUrl, lang }) => {
      if (!secret) return false;
      const msg = renderWaitlistAlready({ place, storedTrade, newTrade, confirmUrl, ...(lang === 'es' ? { lang } : {}) });
      const res = await sendEmail({ to, subject: msg.subject, html: msg.html, text: msg.text });
      return 'ok' in res && res.ok === true;
    },
    siteUrl,
  };
}
