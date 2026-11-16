import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { jsonError, readJson } from '@/lib/auth/api';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
});

/**
 * Always answers {ok:true} (except 429) so the response never reveals whether an email has an account.
 * Only Holler members (app_metadata.products includes 'holler') get a link: membership is read with a
 * side-effect-free RPC first, because admin.generateLink rewrites the recovery token of whoever it is called for,
 * and the same auth.users row may belong to another product. The send happens after the response so timing
 * does not reveal membership either.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;
  const { email } = input.data;

  try {
    const admin = createAdminClient();
    const limited = await hit([LIMITS.forgotEmail(email), LIMITS.forgotIp(clientIp(request))], admin);
    if (limited === 'limited') return jsonError(RATE_LIMIT_MESSAGE, 429);
    if (limited === 'error') return NextResponse.json({ ok: true }); // fail closed: send nothing

    after(async () => {
      try {
        const { data: memberId, error: mErr } = await admin.rpc('holler_member_id', { p_email: email });
        if (mErr || typeof memberId !== 'string') return; // not a Holler account (or lookup failed): do nothing
        const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
        const hashed = data?.properties?.hashed_token;
        if (error || !hashed || data?.user?.id !== memberId) return;
        const link = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=${encodeURIComponent('/reset')}`;
        await sendEmail({
          to: email,
          subject: 'Reset your Holler password',
          text: `Someone asked to reset the password for your Holler account.\n\nOpen this link to choose a new one:\n${link}\n\nIf that wasn't you, ignore this email. Nothing changes until the link is used.`,
          html: `<p>Someone asked to reset the password for your Holler account.</p><p><a href="${link}">Choose a new password</a></p><p>If that wasn't you, ignore this email. Nothing changes until the link is used.</p>`,
        });
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
