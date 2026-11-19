import 'server-only';
import { siteUrl } from '@/lib/env';
import { contactAddress, escapeHtml, sendEmail, type Rendered } from '@/lib/email';
import { verifyUrlFor } from '@/lib/auth/verification';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';

/**
 * The plain "confirm your email" message (verify-v3 P1, commander decision 9). Sent to a returning member (had a Holler trial before:
 * deleted the account and came back) who onboards again in the app, instead of the signup welcome (lib/email/templates.ts
 * renderVerifyEmail), which promises a free trial. One trial per person: a returning member's trial keeps its original end and may
 * already be over, so this message says nothing about a trial. Neutral on purpose, so it is also right for any member who asks for the
 * link again once the profile exists. Same look as lib/email/templates.ts (its wrapper and button helpers are not exported).
 */
export const CONFIRM_ONLY_SUBJECT = 'Confirm your email for Holler';

const WRAP_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#191714;background:#FAF6EE;line-height:1.5">';
const WRAP_CLOSE = '</div>';

/** Pure. */
export function renderConfirmEmailOnly(o: { verifyUrl: string; appUrl: string }): Rendered {
  const a = contactAddress();
  const lead = 'Confirm this email address so we can send you Holler alerts. The link works for 7 days.';
  const ignore = 'If you did not ask for this, ignore this email and nothing happens.';
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:22px;margin:0 0 12px 0">${escapeHtml(CONFIRM_ONLY_SUBJECT)}</h1>` +
    `<p style="margin:0 0 12px 0">${escapeHtml(lead)}</p>` +
    `<p style="margin:20px 0"><a href="${escapeHtml(o.verifyUrl)}" style="background:#E8590C;color:#191714;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block;font-weight:600">Confirm my email</a></p>` +
    `<p style="font-size:14px;color:#5C574F">Your alerts: <a href="${escapeHtml(o.appUrl)}" style="color:#5C574F">${escapeHtml(o.appUrl)}</a>. ${escapeHtml(ignore)}` +
    (a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="color:#5C574F">Contact us</a>.` : '') +
    `</p>` +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `${CONFIRM_ONLY_SUBJECT}\n\n${lead}\n\n${o.verifyUrl}\n\nYour alerts: ${o.appUrl}\n\n${ignore}\n` +
    (a ? `Questions? Contact us: ${a}\n` : '') +
    `\n${postalFooterText()}\n`;
  return { subject: CONFIRM_ONLY_SUBJECT, html, text };
}

/** Signs the link and sends the confirm-only message. Never throws. */
export async function sendConfirmOnlyEmail(userId: string, email: string): Promise<boolean> {
  try {
    const verifyUrl = verifyUrlFor(userId);
    if (!verifyUrl) {
      console.error('[verify] CRON_SECRET missing, cannot sign verification link');
      return false;
    }
    const mail = renderConfirmEmailOnly({ verifyUrl, appUrl: `${siteUrl}/app` });
    const res = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    return !('skipped' in res && res.skipped) && 'ok' in res && res.ok === true;
  } catch (e) {
    console.error('[verify] confirm-only send failed', e instanceof Error ? e.message : e);
    return false;
  }
}
