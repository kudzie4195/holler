import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { friendlyAuthError, isConfigError, jsonError, readJson } from '@/lib/auth/api';

const body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(input.data);
    if (error) {
      const { message, status } = friendlyAuthError(error);
      return jsonError(message, status);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Log in is not switched on yet. Please check back soon.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
