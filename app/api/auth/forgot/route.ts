import { NextResponse } from 'next/server';
import { z } from 'zod';
import { siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { readJson } from '@/lib/auth/api';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
});

/**
 * Always answers success so the response never reveals whether an email has an account.
 * Real work: admin.generateLink(recovery) -> our own /auth/confirm link -> sendEmail.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;
  const { email } = input.data;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    const hashed = data?.properties?.hashed_token;
    if (!error && hashed) {
      const link = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=${encodeURIComponent('/reset')}`;
      await sendEmail({
        to: email,
        subject: 'Reset your Holler password',
        text: `Someone asked to reset the password for your Holler account.\n\nOpen this link to choose a new one:\n${link}\n\nIf that wasn't you, ignore this email. Nothing changes until the link is used.`,
        html: `<p>Someone asked to reset the password for your Holler account.</p><p><a href="${link}">Choose a new password</a></p><p>If that wasn't you, ignore this email. Nothing changes until the link is used.</p>`,
      });
    }
  } catch (e) {
    // Never surface failures here: that would leak which emails exist, and a retry is cheap.
    console.error('forgot-password failed', e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
