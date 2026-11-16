import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { friendlyAuthError, isConfigError, isEmailTaken, jsonError, readJson } from '@/lib/auth/api';
import { clientIp, hit, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/ratelimit';
import { sendVerifyEmail } from '@/lib/auth/verification';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Keep the password under 72 characters.'),
});

/**
 * Creates the account with the admin client (email_confirm: true, so the shared project's
 * confirmation emails are never sent), tags it app_metadata.products=['holler'], then signs in with the
 * cookie-aware server client and sends Holler's own welcome + verify email.
 *
 * Shared project: if the email already exists the existing user is NOT touched, and the answer is the
 * generic "log in" shape, never a 409.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;
  const { email, password } = input.data;

  try {
    const admin = createAdminClient();
    const limited = await hit([LIMITS.signupIp(clientIp(request)), LIMITS.signupEmail(email)], admin);
    if (limited === 'limited') return jsonError(RATE_LIMIT_MESSAGE, 429);
    if (limited === 'error') return jsonError('Something went wrong on our side. Try again in a moment.', 503);

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { products: ['holler'] },
    });
    if (created.error) {
      if (isEmailTaken(created.error)) {
        // Do not reveal that the address is registered, and do not modify that user (it may belong to another product).
        return NextResponse.json({
          ok: true,
          signedIn: false,
          next: '/login',
          message: 'If you already have an account, log in.',
        });
      }
      const { message, status } = friendlyAuthError(created.error);
      return jsonError(message, status);
    }
    const userId = created.data.user.id;

    after(async () => {
      await sendVerifyEmail(userId, email);
    });

    const supabase = await createClient();
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (signedIn.error) {
      return NextResponse.json({ ok: true, signedIn: false, next: '/login', message: 'If you already have an account, log in.' });
    }
    return NextResponse.json({ ok: true, signedIn: true, next: '/onboarding' });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Sign-up is not switched on yet. Please check back soon.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
