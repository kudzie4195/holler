import 'server-only';
import { sendEmail } from '@/lib/email';

export interface RequestEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Business replies only: the business's own address, so the resident's answer goes straight to it. */
  replyTo?: string;
}

/**
 * True when the message was handed to Resend. Every request email goes through lib/email sendEmail; replies pass the business's
 * address as replyTo (instead of SUPPORT_EMAIL). Never logs an address.
 */
export async function sendRequestEmail(msg: RequestEmail): Promise<boolean> {
  const res = await sendEmail({
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  });
  if ('skipped' in res && res.skipped) return false;
  if ('ok' in res && res.ok) return true;
  console.error('[requests] email send failed');
  return false;
}
