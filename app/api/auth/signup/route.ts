import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { friendlyAuthError, isConfigError, jsonError, readJson } from '@/lib/auth/api';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Keep the password under 72 characters.'),
});

/**
 * Creates the account with the admin client (email_confirm: true, so the shared project's
 * confirmation emails are never sent), then signs in with the cookie-aware server client.
 */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;
  const { email, password } = input.data;

  try {
    const admin = createAdminClient();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) {
      const { message, status } = friendlyAuthError(created.error);
      return jsonError(message, status);
    }

    const supabase = await createClient();
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (signedIn.error) {
      // Account exists; ask them to log in rather than leave them stranded.
      return NextResponse.json({ ok: true, signedIn: false, next: '/login' });
    }
    return NextResponse.json({ ok: true, signedIn: true, next: '/onboarding' });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Sign-up is not switched on yet. Please check back soon.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
