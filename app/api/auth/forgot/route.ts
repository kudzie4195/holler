import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPasswordReset, sendEmail } from '@/lib/email';
import { authMessage, jsonError, readJsonLang } from '@/lib/auth/api';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';
import { loadMemberLang, signupLang } from '@/lib/auth/member-lang';
import { t, type Lang } from '@/lib/i18n';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
});

function bodyFor(lang: Lang) {
  if (lang === 'en') return body;
  return z.object({ email: z.string().trim().toLowerCase().pipe(z.email(t(lang, 'api.email_invalid'))) });
}

/**
 * Always answers {ok:true} (except 429) so the response never reveals whether an email has an account.
 * Only Holler members (app_metadata.products includes 'holler') get a link: membership is read with a
 * side-effect-free RPC first, because admin.generateLink rewrites the recovery token of whoever it is called for,
 * and the same auth.users row may belong to another product. The send happens after the response so timing
 * does not reveal membership either.
 *
 * Language (round 18 ES): the email is in the member's saved language (profile column, migration 0024), else the language parked at
 * sign-up, else the language of the page the request came from (the Spanish page sends lang 'es'). The link opens /es/reset for a
 * Spanish email. Every read for this is best effort: a failure falls back to the page language and never blocks the send.
 */
export async function POST(request: Request) {
  const input = await readJsonLang(request, bodyFor);
  if (!input.ok) return input.response;
  const { email } = input.data;
  const pageLang = input.lang;

  try {
    const admin = createAdminClient();
    const limited = await hit([LIMITS.forgotEmail(email), LIMITS.forgotIp(clientIp(request))], admin);
    if (limited === 'limited') return jsonError(authMessage(pageLang, 'api.rate', RATE_LIMIT_MESSAGE), 429);
    if (limited === 'error') return NextResponse.json({ ok: true }); // fail closed: send nothing

    after(async () => {
      try {
        const { data: memberId, error: mErr } = await admin.rpc('holler_member_id', { p_email: email });
        if (mErr || typeof memberId !== 'string') return; // not a Holler account (or lookup failed): do nothing
        const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
        const hashed = data?.properties?.hashed_token;
        if (error || !hashed || data?.user?.id !== memberId) return;
        const saved = await loadMemberLang(admin, memberId);
        const parked = signupLang(data?.user?.app_metadata);
        const lang: Lang = saved ?? (parked !== 'en' ? parked : pageLang);
        const link = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=${encodeURIComponent(lang === 'en' ? '/reset' : '/es/reset')}`;
        const mail = lang === 'en' ? renderPasswordReset({ resetUrl: link }) : renderPasswordReset({ resetUrl: link, lang });
        await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
      } catch (e) {
        console.error('forgot-password failed', e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    // Never surface failures here: that would leak which emails exist, and a retry is cheap.
    console.error('forgot-password failed', e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
