import { Resend } from 'resend';
import { env } from '../env';

export * from './templates';
export * from './token';
export * from './notify-logic';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type SendEmailResult =
  | { skipped: true }
  | { skipped?: false; ok: true; id?: string }
  | { skipped?: false; ok: false; error: string };

export const DEFAULT_FROM = 'Holler <alerts@holler.local>';

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY missing, skipped "${input.subject}"`);
    return { skipped: true };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM || DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
