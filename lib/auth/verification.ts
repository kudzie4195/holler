import 'server-only';
import { env, siteUrl } from '@/lib/env';
import { renderVerifyEmail, sendEmail, signVerifyToken } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';

export function verifyUrlFor(userId: string): string | null {
  if (!env.CRON_SECRET) return null;
  return `${siteUrl}/api/auth/verify?t=${encodeURIComponent(signVerifyToken(userId, env.CRON_SECRET))}`;
}

/** Sends the welcome + confirm-your-email message. Never throws. */
export async function sendVerifyEmail(userId: string, email: string): Promise<boolean> {
  try {
    const verifyUrl = verifyUrlFor(userId);
    if (!verifyUrl) {
      console.error('[verify] CRON_SECRET missing, cannot sign verification link');
      return false;
    }
    const mail = renderVerifyEmail({ verifyUrl, appUrl: `${siteUrl}/app` });
    const res = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    return !('skipped' in res && res.skipped) && 'ok' in res && res.ok === true;
  } catch (e) {
    console.error('[verify] send failed', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Records that the email was confirmed. The profile row may not exist yet (people often click the link
 * before onboarding), so when no row was updated the fact is parked in app_metadata under a Holler-only
 * key and applied by applyPendingVerification() once the profile exists.
 */
export async function markEmailVerified(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('holler_profiles')
    .update({ email_verified_at: now })
    .eq('user_id', userId)
    .is('email_verified_at', null)
    .select('user_id');
  if (error) return false;
  if (data && data.length > 0) return true;

  const { data: existing } = await admin.from('holler_profiles').select('user_id').eq('user_id', userId).maybeSingle();
  if (existing) return true; // already verified earlier
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
  if (uErr || !u?.user) return false;
  const { error: mErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { holler_email_verified_at: now },
  });
  return !mErr;
}

/** Applies a verification parked by markEmailVerified() before the profile existed. Never throws. */
export async function applyPendingVerification(user: { id: string; app_metadata?: unknown }): Promise<void> {
  try {
    const at = (user.app_metadata as { holler_email_verified_at?: unknown } | undefined)?.holler_email_verified_at;
    if (typeof at !== 'string') return;
    await createAdminClient()
      .from('holler_profiles')
      .update({ email_verified_at: at })
      .eq('user_id', user.id)
      .is('email_verified_at', null);
  } catch (e) {
    console.error('[verify] pending apply failed', e instanceof Error ? e.message : e);
  }
}
