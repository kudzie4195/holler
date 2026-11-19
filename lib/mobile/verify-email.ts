import 'server-only';
import { siteUrl } from '@/lib/env';
import { contactAddress, escapeHtml, sendEmail, type Rendered } from '@/lib/email';
import { verifyUrlFor } from '@/lib/auth/verification';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import { EMAIL_STYLE, PRIMARY_BUTTON_STYLE, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from '@/lib/email/theme';

/**
 * The plain "confirm your email" message (verify-v3 P1, commander decision 9). Sent to a returning member (had a Holler trial before:
 * deleted the account and came back) who onboards again in the app, instead of the signup welcome (lib/email/templates.ts
 * renderVerifyEmail), which promises a free trial. One trial per person: a returning member's trial keeps its original end and may
 * already be over, so this message says nothing about a trial. Neutral on purpose, so it is also right for any member who asks for the
 * link again once the profile exists. Same look as lib/email/templates.ts (every color and font from lib/email/theme.ts).
 */
export const CONFIRM_ONLY_SUBJECT = 'Confirm your email for Holler';

const WRAP_OPEN = wrapOpen();
const WRAP_CLOSE = THEME_WRAP_CLOSE;
const S = EMAIL_STYLE;

/** Pure. */
export function renderConfirmEmailOnly(o: { verifyUrl: string; appUrl: string }): Rendered {
  const a = contactAddress();
  const lead = 'Confirm this email address so we can send you Holler alerts. The link works for 7 days.';
  const ignore = 'If you did not ask for this, ignore this email and nothing happens.';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">${escapeHtml(CONFIRM_ONLY_SUBJECT)}</h1>` +
    `<p style="margin:0 0 12px 0">${escapeHtml(lead)}</p>` +
    `<p style="margin:20px 0"><a href="${escapeHtml(o.verifyUrl)}" style="${PRIMARY_BUTTON_STYLE}">Confirm my email</a></p>` +
    `<p style="${S.muted}">Your alerts: <a href="${escapeHtml(o.appUrl)}" style="${S.mutedLink}">${escapeHtml(o.appUrl)}</a>. ${escapeHtml(ignore)}` +
    (a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">Contact us</a>.` : '') +
    `</p>` +
    cardClose() +
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
