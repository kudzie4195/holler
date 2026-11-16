import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { friendlyAuthError, isConfigError, jsonError, readJson } from '@/lib/auth/api';

const body = z.object({
  password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Keep the password under 72 characters.'),
});

/** Sets a new password for the session created by /auth/confirm (type=recovery). */
export async function POST(request: Request) {
  const input = await readJson(request, body);
  if (!input.ok) return input.response;

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return jsonError('This reset link has expired. Ask for a new one.', 401);

    const { error } = await supabase.auth.updateUser({ password: input.data.password });
    if (error) {
      const { message, status } = friendlyAuthError(error);
      return jsonError(message, status);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isConfigError(e)) return jsonError('Password reset is not switched on yet.', 503);
    return jsonError('Something went wrong on our side. Try again in a moment.', 500);
  }
}
