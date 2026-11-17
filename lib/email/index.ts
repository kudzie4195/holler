import { Resend } from 'resend';
import { env } from '../env';

export * from './templates';
export * from './token';
export * from './notify-logic';
export * from './health';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Reply-To for this message. When absent, SUPPORT_EMAIL (if set) is used, as before. */
  replyTo?: string;
}

export type SendEmailResult =
  | { skipped: true; reason: 'no_api_key' | 'no_from' }
  | { skipped?: false; ok: true; id?: string }
  | { skipped?: false; ok: false; error: string };

/**
 * Sends through Resend.
 * - No RESEND_API_KEY: skipped ('no_api_key').
 * - No EMAIL_FROM: skipped ('no_from'). There is no default sender on purpose: a made-up From address is undeliverable
 *   and looks like it worked (F-16).
 * - Reply-To: `input.replyTo` when given (resident request replies use the business's address); otherwise SUPPORT_EMAIL, when set,
 *   so "reply to this email" reaches a real inbox.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY missing, skipped "${input.subject}"`);
    return { skipped: true, reason: 'no_api_key' };
  }
  if (!env.EMAIL_FROM) {
    console.log(`[email] EMAIL_FROM missing, skipped "${input.subject}"`);
    return { skipped: true, reason: 'no_from' };
  }
  const replyTo = input.replyTo?.trim() || env.SUPPORT_EMAIL || undefined;
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
