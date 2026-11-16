import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Reads and validates a JSON body. Requires application/json, which a cross-site HTML form cannot send,
 * so it doubles as a basic CSRF guard for these cookie-setting routes.
 */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { ok: false, response: jsonError('Unsupported request.', 415) };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError('That request was not valid.', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError(parsed.error.issues[0]?.message ?? 'Check your details and try again.', 400) };
  }
  return { ok: true, data: parsed.data };
}

interface AuthLikeError {
  code?: string;
  status?: number;
  message?: string;
}

/** Turns a Supabase auth error into a short message and status that is safe to show. */
export function friendlyAuthError(error: AuthLikeError): { message: string; status: number } {
  const code = error.code ?? '';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) {
    return { message: 'Too many tries. Wait a minute, then try again.', status: 429 };
  }
  if (code === 'invalid_credentials') {
    return { message: INVALID_LOGIN_MESSAGE, status: 401 };
  }
  if (code === 'weak_password') {
    return { message: error.message || 'Pick a stronger password.', status: 400 };
  }
  return { message: 'Something went wrong on our side. Try again in a moment.', status: 500 };
}

/** True when an auth error means the email is already registered (never shown to the caller; see signup). */
export function isEmailTaken(error: AuthLikeError): boolean {
  return error.code === 'email_exists' || error.code === 'user_already_exists';
}

export const INVALID_LOGIN_MESSAGE = "That email and password don't match.";

export function isConfigError(e: unknown): boolean {
  return e instanceof Error && /not configured/i.test(e.message);
}
